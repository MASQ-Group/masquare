# -*- coding: utf-8 -*-
import json,re,glob,html,os,sys
ALLOW_IN_TEXT={'LHT65N-868', 'LT-22222-L-868', 'UG65-L04EU-868M-EA', 'CL-541XL', 'TRA-400C24', 'NBP013OR', 'KLC-AF80'}
ALLOWED={'short_description':{'p','ul','ol','li','strong','em'},
         'long_description':{'h2','p','strong','em','ul','ol','li','br'},
         'specifications':{'table','tbody','thead','tr','th','td'}}
def check(bid):
    inp={x['sku']:x for x in json.load(open(f'in/{bid}.json',encoding='utf-8'))}
    f=f'out/{bid}.json'
    if not os.path.exists(f): return ["MISSING OUTPUT FILE"],[],[]
    try: recs=json.load(open(f,encoding='utf-8'))
    except Exception as e: return [f"INVALID JSON: {e}"],[],[]
    if isinstance(recs,dict): recs=recs.get('products',recs.get('assignments',[]))
    errs=[];warn=[];seen=set()
    for r in recs:
        s=r.get('sku')
        if s not in inp: errs.append(f"{s}: not in this batch's input"); continue
        if s in seen: errs.append(f"{s}: duplicate"); continue
        seen.add(s)
        for k in ('product_title','ebay_title','short_description','long_description','specifications'):
            if k not in r: errs.append(f"{s}: missing field {k}")
        if 'key_features' not in r or not isinstance(r.get('key_features'),list):
            errs.append(f"{s}: key_features missing/not list")
        txt=" ".join([str(r.get(k,'')) for k in ('product_title','ebay_title','short_description','long_description','specifications')]+[str(x) for x in r.get('key_features',[])])
        if s not in ALLOW_IN_TEXT:
            if s.lower() in txt.lower(): errs.append(f"{s}: SKU leaked into text")
            for part in re.split(r'[+]',s):
                if len(part)>7 and part.lower() in txt.lower(): errs.append(f"{s}: SKU fragment leaked '{part}'")
        t=r.get('product_title','') or ''
        if not t.strip(): errs.append(f"{s}: empty product_title")
        e=r.get('ebay_title','') or ''
        if len(e)>80: errs.append(f"{s}: ebay_title {len(e)}>80")
        sd=r.get('short_description','') or ''
        if sd:
            m=re.match(r'\s*<p>(.*?)</p>',sd,re.S)
            if not m: errs.append(f"{s}: short_description missing leading <p>")
            else:
                p=html.unescape(re.sub('<[^>]+>','',m.group(1))).strip()
                if len(p)>80: errs.append(f"{s}: short_desc sentence {len(p)}>80")
            lis=re.findall(r'<li>(.*?)</li>',sd,re.S)
            if len(lis)>3: errs.append(f"{s}: {len(lis)} bullets >3")
            for li in lis:
                pp=html.unescape(re.sub('<[^>]+>','',li)).strip()
                if len(pp)>75: errs.append(f"{s}: bullet {len(pp)}>75")
        kf=r.get('key_features',[]) or []
        if len(kf)>5: errs.append(f"{s}: {len(kf)} key_features >5")
        for k in kf:
            if len(k)>35: errs.append(f"{s}: key_feature {len(k)}>35 '{k}'")
        ld=r.get('long_description','') or ''
        if ld and not ld.lstrip().startswith('<h2>'): errs.append(f"{s}: long_description not opening <h2>")
        for field,allow in ALLOWED.items():
            v=r.get(field,'') or ''
            for tag in set(x.lower() for x in re.findall(r'<\s*/?\s*([a-zA-Z0-9]+)',v)):
                if tag not in allow: errs.append(f"{s}: {field} disallowed tag <{tag}>")
            for attr in set(x.lower() for x in re.findall(r'<[a-zA-Z0-9]+\s+([a-zA-Z-]+)=',v)):
                if attr!='colspan': errs.append(f"{s}: {field} disallowed attr {attr}")
        sp=r.get('specifications','') or ''
        if sp and '<table' not in sp: errs.append(f"{s}: specifications not a table")
        for bad in ['>N/A<','>n/a<','>Unknown<','>TBC<','>-<','>—<','>?<']:
            if bad in sp: warn.append(f"{s}: placeholder row {bad}")
        if re.search(r'https?://|\bsource:|according to',txt,re.I): errs.append(f"{s}: source/URL in output")
    miss=set(inp)-seen
    if miss: errs.append(f"MISSING {len(miss)} skus: {sorted(miss)[:6]}")
    return errs,warn,recs

if __name__=='__main__':
    bids=sys.argv[1:] or [os.path.basename(x)[:-5] for x in sorted(glob.glob('in/*.json')) if not x.endswith('.prompt.txt')]
    tot=0;bad=0
    for bid in bids:
        if not os.path.exists(f'out/{bid}.json'): continue
        errs,warn,recs=check(bid)
        tot+=len(recs)
        status="OK  " if not errs else "FAIL"
        if errs: bad+=1
        print(f"{status} {bid}  {len(recs):>3} recs  errors={len(errs)} warnings={len(warn)}")
        for e in errs[:8]: print("      !",e)
        for x in warn[:3]: print("      ~",x)
    print(f"\nvalidated {tot} products across completed batches; {bad} batches failing")
