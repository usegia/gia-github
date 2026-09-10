import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-error">
      <span className="eyebrow">OUTSIDE THE COLLECTION</span>
      <h1>This page is not in our index.</h1>
      <p>
        A missing profile means we have not collected it. It says nothing about their work on
        GitHub.
      </p>
      <Link className="button button-primary" href="/">
        Explore the collection
      </Link>
    </div>
  );
}
