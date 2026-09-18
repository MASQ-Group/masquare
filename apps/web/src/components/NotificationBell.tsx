import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { notificationsApi, type NotificationRow } from '../lib/api';
import { countRose, newArrivals } from '../lib/notificationArrivals';

/**
 * What the platform has to tell you, in the top bar.
 *
 * Polled rather than pushed: a live connection is a thing that breaks quietly, and nothing the
 * platform has to say is worth less if it arrives within the minute. The badge is a count — cheap
 * enough to ask for every minute — and the list itself is only fetched when the panel is opened.
 *
 * Reading is a side effect of acting on one: clicking a notification takes you to the screen it is
 * about and marks it read on the way, because a person who has followed the link has, by any useful
 * definition, seen it.
 *
 * A new one also says so out loud. A number quietly changing above an icon is not something anybody
 * notices while working in another part of the screen — which was the whole complaint — so it
 * arrives as a toast that goes where the notification goes. Only when the count actually rises, and
 * only for what this tab has not already announced; the rules for that are in notificationArrivals.
 */
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const count = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    // A minute. Often enough to feel current, rare enough to be invisible in a log.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list(20),
    enabled: open,
  });

  const read = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  /**
   * Announce what has just arrived.
   *
   * The list is fetched here rather than polled: a count is cheap to ask for every minute and a
   * list is not, and the only moment the list is interesting is the moment the count goes up.
   */
  const lastCount = useRef<number | null>(null);
  const announced = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unread = count.data?.unread;
    if (unread == null) return;
    const before = lastCount.current;
    lastCount.current = unread;
    if (!countRose(before, unread)) return;

    let alive = true;
    notificationsApi.list(10).then((data) => {
      if (!alive) return;
      const arrivals = newArrivals(announced.current, data.items);
      for (const n of arrivals) announced.current.add(n.id);
      // Oldest of the batch first, so the newest ends up nearest the eye.
      for (const n of [...arrivals].reverse()) {
        toast(n.title, {
          description: n.body ?? undefined,
          duration: 8000,
          ...(n.link ? { action: { label: 'Open', onClick: () => { read.mutate(n.id); navigate(n.link!); } } } : {}),
        });
      }
      // The panel, should it be open, may as well show what we just fetched.
      qc.setQueryData(['notifications', 'list'], data);
    }).catch(() => {
      // A toast that cannot be fetched is not worth an error on screen; the badge still moved.
    });
    return () => { alive = false; };
    // `read` and `navigate` are stable; re-running on them would re-announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count.data?.unread]);

  // Clicking away closes it, as does Escape. Both, because either alone is the one somebody tries.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  const unread = count.data?.unread ?? 0;
  const items = list.data?.items ?? [];

  const choose = (n: NotificationRow) => {
    if (!n.readAt) read.mutate(n.id);
    setOpen(false);
    // Only ever an in-app path — the server stores nothing else — so this cannot leave the platform.
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={panel}>
      <button
        className="relative grid h-[38px] w-[38px] place-items-center rounded-md text-n-600 hover:bg-n-100"
        title={unread ? `${unread} unread` : 'Notifications'}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-orange-600 px-[3px] text-[9.5px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[44px] z-50 w-[360px] overflow-hidden rounded-lg border border-n-200 bg-n-0 shadow-lg max-[520px]:w-[calc(100vw-2rem)]">
          <div className="flex items-center justify-between border-b border-n-100 px-3.5 py-2.5">
            <span className="text-[13px] font-semibold text-n-800">Notifications</span>
            {unread > 0 && (
              <button className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:underline" onClick={() => readAll.mutate()}>
                <CheckCheck size={13} />Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-auto">
            {list.isLoading ? (
              <div className="px-3.5 py-8 text-center text-[12.5px] text-n-500">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-[12.5px] text-n-500">Nothing to report.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => choose(n)}
                  className={`flex w-full gap-2.5 border-b border-n-100 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-n-25 ${n.readAt ? '' : 'bg-teal-50/40'}`}
                >
                  {/* Unread is a dot rather than bold text: the list stays readable when most of it
                      is unread, which is exactly when it is being used. */}
                  <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-teal-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-n-800">{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-[12px] leading-snug text-n-600">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-n-400">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** How long ago, in the words somebody would use. Exact dates once it stops being recent. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
