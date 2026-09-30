import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">CourseForge</h1>
      <p className="text-lg text-muted-foreground">
        Tell us what you want to learn and how much time you have. We research
        the web and build you a day-by-day course with cited lessons, videos,
        and quizzes.
      </p>
      <div>
        <Link href="/new" className={buttonVariants({ size: "lg" })}>
          Start a course
        </Link>
      </div>
    </main>
  );
}
