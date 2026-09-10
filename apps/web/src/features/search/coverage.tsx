import type { Coverage } from "@gia-github/search/contracts";
import { ArrowUpRight, Database, GitPullRequest, Users } from "lucide-react";
import { formatCount, formatDate } from "@/lib/utils";

export function CollectionCoverage({ coverage }: { coverage: Coverage }) {
  return (
    <section className="collection-panel" id="collection" aria-labelledby="collection-title">
      <div className="section-heading">
        <span className="eyebrow">A SMALL, GROWING INDEX</span>
        <Database size={16} aria-hidden="true" />
      </div>
      <h2 id="collection-title">Inside the collection</h2>
      <dl className="coverage-stats">
        <div>
          <dt>
            <Users size={14} aria-hidden="true" />
            People
          </dt>
          <dd>{formatCount(coverage.people)}</dd>
        </div>
        <div>
          <dt>
            <Database size={14} aria-hidden="true" />
            Repositories
          </dt>
          <dd>{formatCount(coverage.repositories)}</dd>
        </div>
        <div>
          <dt>
            <GitPullRequest size={14} aria-hidden="true" />
            Pull requests
          </dt>
          <dd>{formatCount(coverage.pullRequests)}</dd>
        </div>
        <div>
          <dt>Reviews</dt>
          <dd>{formatCount(coverage.reviews)}</dd>
        </div>
      </dl>
      <div className="coverage-status">
        <span
          className={coverage.partialSources ? "status-dot status-dot-partial" : "status-dot"}
          aria-hidden="true"
        />
        {coverage.partialSources
          ? `${formatCount(coverage.partialSources)} collection sources are partial`
          : "No sources currently marked partial"}
      </div>
      <p className="coverage-notice">{coverage.notice}</p>
      <p className="coverage-date">
        {coverage.observedAt
          ? `Latest observation ${formatDate(coverage.observedAt)}`
          : "No collection date available yet"}
      </p>
    </section>
  );
}

export function SearchGuide() {
  return (
    <section className="search-guide" aria-labelledby="guide-title">
      <div className="section-heading">
        <span className="eyebrow">FOLLOW THE WORK</span>
        <ArrowUpRight size={17} aria-hidden="true" />
      </div>
      <h2 id="guide-title">More than a keyword match.</h2>
      <p>
        Describe the connection you have in mind. Gia searches the relationships between people,
        projects, and public contributions.
      </p>
      <div className="relationship-example" aria-hidden="true">
        <span>person</span>
        <i />
        <span>contribution</span>
        <i />
        <span>project</span>
      </div>
      <p className="guide-detail">
        Try an organization, a project capability, and a time window. The more specific the
        question, the clearer the answer.
      </p>
    </section>
  );
}
