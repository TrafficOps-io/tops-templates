// shape: line | block | card
export default function Skeleton({ shape = 'line', width, height, className = '' }) {
  return <span aria-hidden="true" className={`studio-skeleton studio-skeleton-${shape} ${className}`} style={{ width, height }} />;
}
