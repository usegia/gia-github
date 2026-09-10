import { personSchema } from "@gia-github/search/contracts";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProfileSummary, PublicActivity } from "@/features/people/person-details";
import { getSearchService } from "@/lib/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PersonPage({ params }: { params: Promise<{ login: string }> }) {
  const login = z
    .string()
    .regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i)
    .safeParse((await params).login);
  if (!login.success) notFound();
  const result = await getSearchService().person(login.data);
  if (!result) notFound();
  const person = personSchema.parse(result);
  return (
    <div className="profile-page">
      <Link href="/" className="back-link">
        <ArrowLeft size={15} aria-hidden="true" />
        Back to people search
      </Link>
      <div className="profile-layout">
        <aside className="profile-summary">
          <span className="eyebrow">PUBLIC GITHUB PROFILE</span>
          <ProfileSummary person={person} />
          <p className="profile-disclaimer">
            Organization membership is public affiliation, not verified employment. Location and
            company are self-reported.
          </p>
        </aside>
        <section className="profile-activity">
          <div className="section-heading">
            <div>
              <span className="eyebrow">FOLLOW THE SOURCES</span>
              <h2>Collected public activity</h2>
            </div>
          </div>
          <PublicActivity person={person} />
        </section>
      </div>
    </div>
  );
}
