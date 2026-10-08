const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The last eight hex digits: the random end of a v7 id, so two ids minted in
 * the same minute — which share their first eight — still read apart.
 */
function short(segment: string): string {
  return UUID.test(segment) ? segment.replaceAll("-", "").slice(-8) : segment;
}

/**
 * Where the reader is, as a shell would print it: `~/events/0000a1b2/thread`.
 * The route's own path, plus the two query parameters that pick what is on
 * screen (`tab` on an event, `thread` on Messages). Everything else in the
 * query is a filter, not a place.
 */
export function promptPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean).map(short);
  for (const key of ["tab", "thread"]) {
    const value = params.get(key);
    if (value) segments.push(short(value));
  }
  return segments.length === 0 ? "~" : `~/${segments.join("/")}`;
}
