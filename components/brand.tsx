import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="OfficeGhost — на главную">
      <span className="brand-mark" aria-hidden="true"><i /></span>
      <span>OfficeGhost</span>
    </Link>
  );
}
