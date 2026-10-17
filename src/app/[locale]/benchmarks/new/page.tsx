import { redirect } from "@/i18n/navigation";

/** Evaluations are proposed as crowdfunds: old links go to the proposal form in evaluation mode */
export default async function NewBenchmarkPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ skill?: string }> }) {
  const { locale } = await params;
  const { skill } = await searchParams;
  redirect({ href: `/crowd/new?kind=evaluation${skill ? `&skill=${encodeURIComponent(skill)}` : ""}`, locale });
}
