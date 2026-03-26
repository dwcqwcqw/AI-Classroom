interface BookCoverProps {
  title: string;
  fallback?: string;
  className?: string;
}

/**
 * Offline pre-generated cover renderer.
 *
 * Covers are now pre-generated and stored in book data (`book.cover`).
 * This component is intentionally pure and does not perform runtime generation.
 */
export function BookCover({ title, fallback, className }: BookCoverProps) {
  return <img src={fallback || '/logo-black.svg'} alt={title} className={className} />;
}
