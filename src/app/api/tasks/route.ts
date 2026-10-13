import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { TaskInput, createTask } from "@/lib/tasks/service";
import { createPayment } from "@/lib/payments";

/** Create a commissioned task (status AWAITING_PAYMENT) and its budget payment intent */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const input = TaskInput.parse(await req.json());
  const task = await createTask(user.id, input);
  const payment = await createPayment({ userId: user.id, purpose: "TASK_BUDGET", amount: input.budget.toFixed(6), taskId: task.id });
  return json({ task: { id: task.id, status: task.status }, payment });
});
