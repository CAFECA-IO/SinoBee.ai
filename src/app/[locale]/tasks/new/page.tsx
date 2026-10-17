import { redirect } from "@/i18n/navigation";

/** Commissioned tasks were replaced by crowdfunding: old links go to the proposal form */
export default async function NewTaskPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ skill?: string }> }) {
  const { locale } = await params;
  const { skill } = await searchParams;
  redirect({ href: `/crowd/new${skill ? `?skill=${encodeURIComponent(skill)}` : ""}`, locale });
}
