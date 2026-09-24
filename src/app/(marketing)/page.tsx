import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col items-start justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">CourseForge</h1>
      <p className="text-lg text-muted-foreground">
        Tell us what you want to learn and how long you have. We research the
        web and build a day-by-day course with cited lessons, curated videos,
        and quizzes.
      </p>
      <Button asChild size="lg">
        <Link href="/new">Build a course</Link>
      </Button>
    </main>
  );
}
