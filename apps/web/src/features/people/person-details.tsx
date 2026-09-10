import type { Person, SourceContext } from "@gia-github/search/contracts";
import { ArrowUpRight, Building2, CalendarDays, GitPullRequest, MapPin, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatCount, formatDate, githubAvatarUrl, githubSourceUrl } from "@/lib/utils";

export function PersonAvatar({ person, large = false }: { person: Person; large?: boolean }) {
  const src = githubAvatarUrl(person.avatarUrl);
  return (
    <span className={`person-avatar ${large ? "person-avatar-large" : ""}`}>
      {src ? (
        <Image src={src} alt="" width={large ? 88 : 52} height={large ? 88 : 52} unoptimized />
      ) : (
        <span aria-hidden="true">{person.login.slice(0, 2)}</span>
      )}
    </span>
  );
}

export function PersonFacts({ person }: { person: Person }) {
  return (
    <div className="person-facts">
      {person.location ? (
        <span>
          <MapPin size={14} aria-hidden="true" />
          {person.location}
        </span>
      ) : null}
      {person.followers !== null ? (
        <span>
          <Users size={14} aria-hidden="true" />
          {formatCount(person.followers)} followers
        </span>
      ) : null}
      {person.organizations.length ? (
        <span>
          <Building2 size={14} aria-hidden="true" />
          Public member: {person.organizations.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

export function PersonTags({ person }: { person: Person }) {
  if (!person.concepts.length) return null;
  return (
    <div className="person-topics">
      <span className="tiny-label">In associated repositories</span>
      <div className="tag-list">
        {person.concepts.slice(0, 5).map((concept) => (
          <span className="tag" key={concept}>
            {concept}
          </span>
        ))}
      </div>
    </div>
  );
}

const contextLabels: Record<SourceContext["kind"], string> = {
  repository: "Repository",
  pull_request: "Pull request",
  review: "Review",
  concept: "Project concept",
  membership: "Public membership",
};

export function PublicActivity({ person }: { person: Person }) {
  return (
    <div className="public-activity">
      <div className="context-note">
        <span className="note-marker" aria-hidden="true">
          i
        </span>
        <p>
          These are collected facts about {person.login}. They provide background and do not, by
          themselves, explain why a search matched this person.
        </p>
      </div>
      {person.context.length ? (
        <ol className="activity-list">
          {person.context.map((source) => {
            const href = githubSourceUrl(source.url);
            return (
              <li
                key={`${source.kind}:${source.url}:${source.sourceRevision}:${source.title}`}
                className="activity-item"
              >
                <div className="activity-kind">
                  <GitPullRequest size={14} aria-hidden="true" />
                  <span>{contextLabels[source.kind]}</span>
                  {source.repository ? (
                    <span className="activity-repository">{source.repository}</span>
                  ) : null}
                </div>
                <h3>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {source.title}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    source.title
                  )}
                </h3>
                {source.excerpt ? <p className="activity-excerpt">{source.excerpt}</p> : null}
                <div className="activity-dates">
                  {source.occurredAt ? <span>Activity {formatDate(source.occurredAt)}</span> : null}
                  <span>Observed {formatDate(source.observedAt)}</span>
                  {source.sourceRevision ? (
                    <code title={source.sourceRevision}>
                      rev {source.sourceRevision.slice(0, 12)}
                    </code>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="empty-context">
          No activity details have been collected for this profile yet. This does not mean they have
          no public activity.
        </p>
      )}
    </div>
  );
}

export function ProfileSummary({ person }: { person: Person }) {
  const profileUrl = githubSourceUrl(person.profileUrl);
  return (
    <>
      <div className="profile-identity">
        <PersonAvatar person={person} large />
        <div>
          <h1>{person.name || person.login}</h1>
          <span className="profile-handle">@{person.login}</span>
        </div>
      </div>
      {person.bio ? <p className="profile-bio">{person.bio}</p> : null}
      <PersonFacts person={person} />
      {person.company ? (
        <p className="self-reported">Self-reported company: {person.company}</p>
      ) : null}
      <PersonTags person={person} />
      <p className="profile-observed">
        <CalendarDays size={14} aria-hidden="true" />
        Profile observed {formatDate(person.observedAt)}
      </p>
      {profileUrl ? (
        <a
          className="button button-secondary profile-external"
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      ) : null}
    </>
  );
}

export function PersonCard({
  person,
  onOpen,
}: {
  person: Person;
  onOpen: (person: Person) => void;
}) {
  return (
    <article className="person-card" data-testid="person-card" data-login={person.login}>
      <div className="person-card-header">
        <PersonAvatar person={person} />
        <div>
          <h3>
            <Link prefetch={false} href={`/people/${encodeURIComponent(person.login)}`}>
              {person.name || person.login}
            </Link>
          </h3>
          <span className="person-handle">@{person.login}</span>
        </div>
        <button
          className="person-open"
          onClick={() => onOpen(person)}
          type="button"
          aria-label={`Open public activity for ${person.login}`}
        >
          <ArrowUpRight size={19} />
        </button>
      </div>
      <p className={`person-bio ${person.bio ? "" : "person-bio-missing"}`}>
        {person.bio || "No public bio collected."}
      </p>
      <PersonFacts person={person} />
      <PersonTags person={person} />
      <div className="person-card-footer">
        <span>
          {person.repositories.length
            ? `${person.repositories.length} collected ${person.repositories.length === 1 ? "repository" : "repositories"}`
            : "Repository coverage unavailable"}
        </span>
        <button type="button" onClick={() => onOpen(person)}>
          Public activity
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
