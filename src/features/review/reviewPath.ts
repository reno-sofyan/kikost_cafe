/** Id order dari alamat halaman ulasan `/ulasan/<orderId>`. */
export function reviewIdFromPath(pathname: string): string {
  return decodeURIComponent(pathname.replace(/^\/ulasan\/?/, '').split('/')[0] ?? '')
}
