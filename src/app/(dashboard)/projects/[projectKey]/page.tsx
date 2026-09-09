import { redirect } from "next/navigation";


export default async function ProjectPage(props: { params: Promise<{ projectKey: string }> }) {
  const params = await props.params;
  redirect(`/projects/${params.projectKey}/board`);
}
