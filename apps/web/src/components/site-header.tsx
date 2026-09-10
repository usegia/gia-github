import { ArrowUpRight, GitBranch } from "lucide-react";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Gia GitHub home">
        <span className="brand-symbol" aria-hidden="true">
          g<span />
        </span>
        <span>
          gia<span className="brand-divider">/</span>
          <span className="brand-product">github</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <a href="/#collection" className="nav-link">
          The collection
        </a>
        <a
          href="https://github.com/usegia/gia-github"
          target="_blank"
          rel="noopener noreferrer"
          className="source-link"
        >
          <GitBranch size={15} aria-hidden="true" /> <span>Source</span>{" "}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>Built with Gia. Connected by public work.</span>
      <span>
        Public data <span aria-hidden="true">·</span> Source-linked context{" "}
        <span aria-hidden="true">·</span> Open application
      </span>
    </footer>
  );
}
