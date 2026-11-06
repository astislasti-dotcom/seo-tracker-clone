// Metadata for the login page. The page itself is a client component, so its metadata
// lives in this server layout. The login is internal: it must not be indexed.
export const metadata = {
  title: 'Acceso · Panel interno ASTI y 3AV Events',
  description: 'Acceso restringido al personal autorizado de SEO Tracker.',
  robots: { index: false, follow: false, nocache: true },
};

export default function LoginLayout({ children }) {
  return children;
}
