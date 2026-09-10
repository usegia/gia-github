"use client";

import {
  type Catalog,
  catalogSchema,
  type Person,
  type SearchOutcome,
  searchInputSchema,
  searchOutcomeSchema,
} from "@gia-github/search/contracts";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  CornerDownLeft,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PersonCard, PublicActivity } from "@/features/people/person-details";
import { CollectionCoverage, SearchGuide } from "@/features/search/coverage";
import { formatCount } from "@/lib/utils";

type SearchState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string }
  | { kind: "complete"; outcome: SearchOutcome };
type CatalogState =
  | { kind: "loading" }
  | { kind: "ready"; catalog: Catalog }
  | { kind: "unavailable" };

export function SearchWorkspace() {
  const parameters = useSearchParams();
  const [question, setQuestion] = useState(() => parameters.get("q")?.slice(0, 2_000) ?? "");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "loading" });
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const pending = state.kind === "pending";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/catalog?refresh=${catalogAttempt}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalog unavailable");
        const parsed = catalogSchema.parse(await response.json());
        setCatalog({ kind: "ready", catalog: parsed });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ kind: "unavailable" });
      });
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    const input = searchInputSchema.safeParse({ question, limit: 20 });
    if (!input.success) {
      setState({
        kind: "error",
        message: "Describe who you are looking for in 3–2,000 characters.",
      });
      inputRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setElapsed(0);
    setState({ kind: "pending" });
    setSelectedPerson(null);
    const url = new URL(window.location.href);
    url.searchParams.set("q", input.data.question);
    window.history.replaceState(null, "", url);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
      });
      const outcome = searchOutcomeSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setState({ kind: "complete", outcome });
      requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }));
    } catch {
      if (controller.signal.aborted) return;
      setState({
        kind: "error",
        message:
          "The search could not finish. Your question is saved; submit it again when you are ready.",
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ kind: "cancelled" });
    inputRef.current?.focus();
  }

  function chooseExample(nextQuestion: string) {
    setQuestion(nextQuestion);
    inputRef.current?.focus();
  }

  const outcome = state.kind === "complete" ? state.outcome : null;
  const coverage =
    outcome?.kind === "matches"
      ? outcome.coverage
      : catalog.kind === "ready"
        ? catalog.catalog.coverage
        : null;

  return (
    <>
      <section className="search-hero" aria-labelledby="hero-title">
        <div className="hero-label">
          <span className="status-dot" aria-hidden="true" />
          GITHUB, IN NATURAL LANGUAGE<span className="preview-label">EARLY COLLECTION</span>
        </div>
        <h1 id="hero-title">
          Find the people.
          <br />
          <span>Follow the work.</span>
        </h1>
        <p className="hero-description">
          The right connection starts with a better question.
          <br className="desktop-break" /> Search the people, projects, and contributions behind
          public code.
        </p>
        <form
          className={`search-form ${pending ? "search-form-pending" : ""}`}
          onSubmit={(event) => void submit(event)}
          aria-label="Search GitHub people"
        >
          <label className="sr-only" htmlFor="people-question">
            Describe the people you want to find
          </label>
          <div className="search-input-row">
            <Search className="search-input-icon" size={22} aria-hidden="true" />
            <textarea
              id="people-question"
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="People at Vercel contributing to AI projects…"
              maxLength={2_000}
              rows={2}
              spellCheck={false}
              aria-describedby="search-hint"
              readOnly={pending}
            />
          </div>
          <div className="search-controls">
            <span id="search-hint" className="search-hint">
              <CornerDownLeft size={12} aria-hidden="true" />
              Enter to search<span className="search-hint-divider">·</span>Shift + Enter for a new
              line
            </span>
            {pending ? (
              <Button variant="secondary" onClick={cancel}>
                <X size={15} aria-hidden="true" />
                Cancel search
              </Button>
            ) : (
              <Button type="submit" disabled={question.trim().length < 3}>
                Find people
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
        </form>
        <div className="search-understatement">
          <span>Searches public work in this collection.</span>
          <span>
            Powered by <strong>gia</strong>
          </span>
        </div>
      </section>

      <div className="workspace-grid">
        <div className="main-column">
          <section
            className="search-results-region"
            ref={resultRef}
            tabIndex={-1}
            aria-label="Search results"
            aria-busy={pending}
          >
            {pending ? (
              <div className="pending-search" role="status">
                <div className="pending-icon">
                  <LoaderCircle size={22} className="spin" aria-hidden="true" />
                </div>
                <div>
                  <h2>Following the connections</h2>
                  <p>
                    Gia is working on your question. More specific searches can take a little
                    longer.
                  </p>
                </div>
                <span
                  className="elapsed-time"
                  role="timer"
                  aria-label={`${elapsed} seconds elapsed`}
                >
                  {elapsed}s
                </span>
              </div>
            ) : null}
            {state.kind === "cancelled" ? (
              <div className="status-message" role="status">
                <h2>Search cancelled</h2>
                <p>Your question is still here. Edit it or try again when you are ready.</p>
              </div>
            ) : null}
            {state.kind === "error" ? (
              <div className="status-message status-error" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <div>
                  <h2>Search could not finish</h2>
                  <p>{state.message}</p>
                </div>
              </div>
            ) : null}
            {outcome?.kind === "failed" ? (
              <div className="status-message status-error" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <div>
                  <h2>Search is unavailable</h2>
                  <p>{outcome.message}</p>
                  <span className="request-reference">Reference {outcome.requestId}</span>
                </div>
              </div>
            ) : null}
            {outcome?.kind === "unsupported" ? (
              <div className="status-message" role="status">
                <h2>This collection cannot answer that yet</h2>
                <p>{outcome.explanation}</p>
                <p>
                  Try a question about public memberships, repositories, pull requests, or reviews.
                </p>
              </div>
            ) : null}
            {outcome?.kind === "matches" ? (
              <>
                <div className="results-heading">
                  <div>
                    <span className="eyebrow">YOUR CONNECTIONS</span>
                    <h2>
                      {formatCount(outcome.people.length)}{" "}
                      {outcome.people.length === 1 ? "person" : "people"} found
                    </h2>
                  </div>
                  <span className="result-duration">
                    {(outcome.durationMs / 1_000).toFixed(1)}s
                  </span>
                </div>
                {outcome.interpretation.kind === "assumed" ? (
                  <div className="interpretation" role="note">
                    <span className="tiny-label">How your question was interpreted</span>
                    <p>{outcome.interpretation.summary}</p>
                    <ul>
                      {outcome.interpretation.assumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {outcome.people.length ? (
                  <div className="people-grid">
                    {outcome.people.map((person) => (
                      <PersonCard key={person.id} person={person} onOpen={setSelectedPerson} />
                    ))}
                  </div>
                ) : (
                  <div className="empty-results">
                    <Search size={25} strokeWidth={1.5} aria-hidden="true" />
                    <h3>No people matched in this collection</h3>
                    <p>
                      Try a broader time window or fewer conditions. Missing collection coverage
                      does not mean the work never happened.
                    </p>
                  </div>
                )}
                {outcome.truncated ? (
                  <p className="truncation-note">
                    This result was limited. Narrow your question to explore a more specific group.
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          {state.kind === "idle" || state.kind === "cancelled" ? (
            <section className="example-section" aria-labelledby="examples-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">A FEW PLACES TO START</span>
                  <h2 id="examples-title">Who are you looking for?</h2>
                </div>
                <ArrowDown size={19} aria-hidden="true" />
              </div>
              {catalog.kind === "ready" && catalog.catalog.examples.length ? (
                <div className="example-list">
                  {catalog.catalog.examples.slice(0, 4).map((example, index) => (
                    <button
                      type="button"
                      className="example-query"
                      onClick={() => chooseExample(example.question)}
                      key={example.question}
                    >
                      <span className="example-number">0{index + 1}</span>
                      <span>
                        <strong>{example.label}</strong>
                        <span>{example.question}</span>
                      </span>
                      <ArrowUpRight size={18} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="example-placeholder">
                  <span className="tiny-label">START WITH A CONNECTION</span>
                  <p>
                    Ask about an organization, a repository, or a kind of public contribution. Add a
                    date range to make it specific.
                  </p>
                </div>
              )}
              <p className="example-caption">Choose a question, make it yours, then search.</p>
            </section>
          ) : null}
          {outcome || state.kind === "error" ? (
            <p className="search-boundary-note">
              Results describe collected public work. Public organization membership is not a
              verified employment record.
            </p>
          ) : null}
        </div>
        <aside className="sidebar" aria-label="About the collection">
          {coverage ? (
            <CollectionCoverage coverage={coverage} />
          ) : (
            <section className="collection-panel" id="collection">
              <span className="eyebrow">THE COLLECTION</span>
              <h2>Public work, with context.</h2>
              {catalog.kind === "loading" ? (
                <p className="coverage-notice" role="status">
                  Reading collection details…
                </p>
              ) : (
                <>
                  <p className="coverage-notice">
                    Collection details are unavailable right now. Counts and freshness will appear
                    when the database is reachable.
                  </p>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      setCatalog({ kind: "loading" });
                      setCatalogAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Retry collection details
                    <ArrowRight size={14} aria-hidden="true" />
                  </Button>
                </>
              )}
            </section>
          )}
          <SearchGuide />
        </aside>
      </div>
      <Sheet
        open={selectedPerson !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPerson(null);
        }}
        title={selectedPerson ? `@${selectedPerson.login}` : "Public activity"}
        description="Public source context, with observation dates and original links."
      >
        {selectedPerson ? (
          <>
            <PublicActivity person={selectedPerson} />
            <Link
              prefetch={false}
              className="button button-secondary sheet-profile-link"
              href={`/people/${encodeURIComponent(selectedPerson.login)}`}
            >
              Open full profile
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </>
        ) : null}
      </Sheet>
    </>
  );
}
