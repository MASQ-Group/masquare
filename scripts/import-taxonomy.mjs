// Import the catalogue taxonomy: 239 product types + 309 categories, then assign all 1,174 SKUs.
//
// Source: "Product Listings Data/taxonomy/" — masquare-taxonomy.json (the tree to create) and
// masquare-product-assignments.json (sku -> product_type_id + category_id).
//
// Idempotent. Rows are matched on their stable handle from the file — `path` for a category,
// `slug` for a product type — so a re-run updates in place rather than creating a second copy.
// A row that already exists by NAME but has no handle yet (the ad-hoc types and categories that
// predate this taxonomy) is adopted: it keeps its id, so every product already pointing at it
// stays pointed at it, and it gains the handle. That matters because deleting and recreating
// "Kettle" would silently orphan every product on it.
//
// Nothing is deleted. Types and categories left over from the old ad-hoc set stay put; they end
// up with no products once the assignments run, and clearing them is a separate, visible decision.
//
// Usage:
//   node scripts/import-taxonomy.mjs                          # dry run — reports, writes nothing
//   node scripts/import-taxonomy.mjs --apply                  # writes
//   node scripts/import-taxonomy.mjs --apply --clear-legacy   # also soft-deletes the leftovers
//
// DATABASE_URL is read from the environment, falling back to the repo-root .env.

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* env already provided */ }
}

const APPLY = process.argv.includes('--apply');
const CLEAR_LEGACY = process.argv.includes('--clear-legacy');
const DIR = join(ROOT, 'Product Listings Data', 'taxonomy');
const prisma = new PrismaClient();

const read = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Refuse to write anything until the file is internally consistent AND matches the catalogue.
 *
 * A half-applied taxonomy is worse than none: products would sit on categories whose parents were
 * never created, and the tree would render with gaps that look like data loss.
 */
function validate(taxonomy, assignments, products) {
  const errors = [];
  const catIds = new Set(taxonomy.categories.map((c) => c.id));
  const typeIds = new Set(taxonomy.product_types.map((p) => p.id));

  if (catIds.size !== taxonomy.categories.length) errors.push('duplicate category ids in taxonomy');
  if (typeIds.size !== taxonomy.product_types.length) errors.push('duplicate product type ids in taxonomy');

  // Parents must exist and must appear before their children, because the tree is created in
  // array order and a child needs its parent's database id.
  const seen = new Set();
  for (const c of taxonomy.categories) {
    if (c.parent_id === null && c.level !== 1) errors.push(`${c.id}: no parent but level ${c.level}`);
    if (c.parent_id !== null) {
      if (!catIds.has(c.parent_id)) errors.push(`${c.id}: parent ${c.parent_id} does not exist`);
      else if (!seen.has(c.parent_id)) errors.push(`${c.id}: appears before its parent`);
    }
    seen.add(c.id);
  }

  // Sibling names must be unique — the categories service rejects a duplicate sibling name, so a
  // clash here would fail mid-import rather than up front.
  const siblings = new Map();
  for (const c of taxonomy.categories) {
    const key = `${c.parent_id ?? 'ROOT'}::${norm(c.name)}`;
    if (siblings.has(key)) errors.push(`sibling name clash: "${c.name}" under ${c.parent_id ?? 'root'}`);
    siblings.set(key, c.id);
  }

  const bySku = new Map(products.map((p) => [p.mainSku, p]));
  const assignedSkus = new Set();
  for (const a of assignments) {
    if (assignedSkus.has(a.sku)) errors.push(`sku ${a.sku} assigned twice`);
    assignedSkus.add(a.sku);
    if (!bySku.has(a.sku)) errors.push(`sku ${a.sku} is not in the catalogue`);
    if (!catIds.has(a.category_id)) errors.push(`sku ${a.sku}: unknown category ${a.category_id}`);
    if (!typeIds.has(a.product_type_id)) errors.push(`sku ${a.sku}: unknown product type ${a.product_type_id}`);
  }

  const unassigned = products.filter((p) => !assignedSkus.has(p.mainSku));
  return { errors, unassigned };
}

async function main() {
  const taxonomy = read('masquare-taxonomy.json');
  const assignments = read('masquare-product-assignments.json').assignments;

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, productTypeId: true, categoryId: true },
  });

  const { errors, unassigned } = validate(taxonomy, assignments, products);
  if (errors.length) {
    console.error(`Validation failed — ${errors.length} problem(s), nothing written:`);
    for (const e of errors.slice(0, 25)) console.error('  •', e);
    if (errors.length > 25) console.error(`  … and ${errors.length - 25} more`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated: ${taxonomy.categories.length} categories, ${taxonomy.product_types.length} product types, ${assignments.length} assignments.`);
  if (unassigned.length) console.log(`Note: ${unassigned.length} catalogue product(s) are not in the assignments file and will be left untouched.`);

  // --- Existing rows, indexed both ways -------------------------------------
  // By handle for a re-run; by name to adopt the ad-hoc rows that predate this taxonomy.
  const existingTypes = await prisma.productType.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true } });
  const existingCats = await prisma.productCategory.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true, path: true, parentId: true } });

  const typeBySlug = new Map(existingTypes.filter((t) => t.slug).map((t) => [t.slug, t]));
  const typeByName = new Map(existingTypes.filter((t) => !t.slug).map((t) => [norm(t.name), t]));
  const catByPath = new Map(existingCats.filter((c) => c.path).map((c) => [c.path, c]));
  const catByParentName = new Map(existingCats.filter((c) => !c.path).map((c) => [`${c.parentId ?? 'ROOT'}::${norm(c.name)}`, c]));

  const stats = { catCreated: 0, catAdopted: 0, catUpdated: 0, typeCreated: 0, typeAdopted: 0, typeUpdated: 0, productsChanged: 0, productsAlready: 0 };

  // --- Categories, in file order so a parent always has a database id --------
  const catIdByPath = new Map();
  for (const c of taxonomy.categories) {
    const parentDbId = c.parent_id ? catIdByPath.get(c.parent_id) : null;
    const data = {
      name: c.name,
      parentId: parentDbId,
      sortOrder: c.position ?? 0,
      slug: c.slug,
      path: c.id,
      showInNavigation: c.show_in_navigation !== false,
    };

    const byPath = catByPath.get(c.id);
    // Adoption only makes sense at the root: a pre-existing ad-hoc category is flat, so it can
    // only correspond to a level-1 entry. Matching deeper would need a parent that does not exist
    // yet in the old data.
    const byName = !byPath && c.level === 1 ? catByParentName.get(`ROOT::${norm(c.name)}`) : null;
    const existing = byPath ?? byName;

    if (existing) {
      if (byName) stats.catAdopted++; else stats.catUpdated++;
      catIdByPath.set(c.id, existing.id);
      if (APPLY) await prisma.productCategory.update({ where: { id: existing.id }, data });
    } else {
      stats.catCreated++;
      if (APPLY) {
        const row = await prisma.productCategory.create({ data });
        catIdByPath.set(c.id, row.id);
      } else {
        catIdByPath.set(c.id, `dry-run:${c.id}`);
      }
    }
  }

  // --- Product types --------------------------------------------------------
  const typeIdBySlug = new Map();
  for (const p of taxonomy.product_types) {
    const data = { name: p.name, slug: p.id };
    const bySlug = typeBySlug.get(p.id);
    const byName = !bySlug ? typeByName.get(norm(p.name)) : null;
    const existing = bySlug ?? byName;

    if (existing) {
      if (byName) stats.typeAdopted++; else stats.typeUpdated++;
      typeIdBySlug.set(p.id, existing.id);
      if (APPLY) await prisma.productType.update({ where: { id: existing.id }, data });
    } else {
      stats.typeCreated++;
      if (APPLY) {
        const row = await prisma.productType.create({ data });
        typeIdBySlug.set(p.id, row.id);
      } else {
        typeIdBySlug.set(p.id, `dry-run:${p.id}`);
      }
    }
  }

  // --- Assignments ----------------------------------------------------------
  const productBySku = new Map(products.map((p) => [p.mainSku, p]));
  for (const a of assignments) {
    const product = productBySku.get(a.sku);
    const categoryId = catIdByPath.get(a.category_id);
    const productTypeId = typeIdBySlug.get(a.product_type_id);
    if (product.categoryId === categoryId && product.productTypeId === productTypeId) {
      stats.productsAlready++;
      continue;
    }
    stats.productsChanged++;
    if (APPLY) await prisma.product.update({ where: { id: product.id }, data: { categoryId, productTypeId } });
  }

  // --- Report ---------------------------------------------------------------
  console.log('');
  console.log(`${APPLY ? 'Applied' : 'Dry run — nothing written'}`);
  console.log(`  Categories     created ${stats.catCreated}, adopted by name ${stats.catAdopted}, updated ${stats.catUpdated}`);
  console.log(`  Product types  created ${stats.typeCreated}, adopted by name ${stats.typeAdopted}, updated ${stats.typeUpdated}`);
  console.log(`  Products       reassigned ${stats.productsChanged}, already correct ${stats.productsAlready}`);

  // Whatever the old ad-hoc set leaves behind. Computed rather than re-queried, so the dry run
  // reports the state the import WOULD produce — querying afterwards would report the state
  // before it, which is exactly the thing a dry run exists to avoid.
  const claimedTypeIds = new Set(typeIdBySlug.values());
  const claimedCatIds = new Set(catIdByPath.values());
  const assignedProductIds = new Set(assignments.map((a) => productBySku.get(a.sku).id));
  // A product still holds an orphan only if the assignments never touched it.
  const stillOn = (rowId, key) => products.filter((p) => p[key] === rowId && !assignedProductIds.has(p.id)).length;

  const orphanTypes = existingTypes.filter((t) => !claimedTypeIds.has(t.id)).map((t) => ({ name: t.name, left: stillOn(t.id, 'productTypeId') }));
  const orphanCats = existingCats.filter((c) => !claimedCatIds.has(c.id)).map((c) => ({ name: c.name, left: stillOn(c.id, 'categoryId') }));

  if (orphanTypes.length || orphanCats.length) {
    console.log('');
    console.log(`Left over from the previous ad-hoc taxonomy${APPLY ? '' : ' (projected)'} — untouched by this import:`);
    if (orphanTypes.length) console.log(`  ${orphanTypes.length} product type(s): ${orphanTypes.map((t) => `${t.name} (${t.left})`).join(', ')}`);
    if (orphanCats.length) console.log(`  ${orphanCats.length} categor(ies): ${orphanCats.map((c) => `${c.name} (${c.left})`).join(', ')}`);
    console.log('  The number in brackets is how many products still point at it afterwards.');
  }

  // Soft-deleting the leftovers is opt-in and separate: it is the only destructive thing here, and
  // it should be a decision someone makes rather than a side effect of importing a taxonomy.
  if (CLEAR_LEGACY) {
    const stranded = [...orphanTypes, ...orphanCats].filter((r) => r.left > 0);
    if (stranded.length) {
      console.log('');
      console.error(`Refusing to clear: ${stranded.length} leftover row(s) still have products — ${stranded.map((r) => `${r.name} (${r.left})`).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const typeIds = existingTypes.filter((t) => !claimedTypeIds.has(t.id)).map((t) => t.id);
    const catIds = existingCats.filter((c) => !claimedCatIds.has(c.id)).map((c) => c.id);
    console.log('');
    if (APPLY) {
      const now = new Date();
      const t = await prisma.productType.updateMany({ where: { id: { in: typeIds } }, data: { deletedAt: now } });
      const c = await prisma.productCategory.updateMany({ where: { id: { in: catIds } }, data: { deletedAt: now } });
      console.log(`Cleared the leftovers: ${t.count} product type(s), ${c.count} categor(ies) soft-deleted.`);
    } else {
      console.log(`Would clear the leftovers: ${typeIds.length} product type(s), ${catIds.length} categor(ies) (soft delete).`);
    }
  } else if (orphanTypes.length || orphanCats.length) {
    console.log('  Pass --clear-legacy to soft-delete them (refused while any still holds a product).');
  }

  if (!APPLY) console.log('\nRe-run with --apply to write.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
