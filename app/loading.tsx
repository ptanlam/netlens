/**
 * What a page shows the moment you switch to it, while the server reads D1 and builds it.
 *
 * One file for every route: it's the Suspense fallback around each page under the root
 * layout, so the nav stays put and only the page area is swapped. Every page is dynamic,
 * so without it a click did nothing visible until the whole new page arrived. The shape
 * is the one most pages share: a header, a row of summary tiles, then a panel.
 */
export default function Loading() {
  const block = "rounded-lg bg-pane-sunk animate-loading-shimmer";
  return (
    <div role="status" aria-label="Loading" className="animate-loading-in flex flex-col gap-3 sm:gap-4">
      <div className="pt-1 sm:pt-3">
        <div className={`${block} h-8 w-56 sm:h-10`} />
        <div className={`${block} mt-3 h-4 w-80 max-w-full`} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card-surface panel-body flex flex-col gap-3">
            <div className={`${block} h-4 w-24`} />
            <div className={`${block} h-7 w-40`} />
          </div>
        ))}
      </div>
      <div className="card-surface panel-body flex flex-col gap-3">
        <div className={`${block} h-5 w-32`} />
        <div className={`${block} h-48 w-full`} />
      </div>
    </div>
  );
}
