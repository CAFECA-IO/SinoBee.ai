import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { TaskInput, createTask } from "@/lib/tasks/service";
import { createPayment } from "@/lib/payments";
import { BuyerInput } from "@/lib/buyer-schema";

/** Create a commissioned task (status AWAITING_PAYMENT) and the Oen checkout for its budget */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  const input = TaskInput.parse(body);
  const buyer = BuyerInput.parse(body.buyer);
  const task = await createTask(user.id, input);
  // checkout failures leave the task AWAITING_PAYMENT; the owner can pay again from the task page
  const payment = await createPayment({ userId: user.id, purpose: "TASK_BUDGET", amountTwd: input.budget, taskId: task.id, buyer }).catch((e) => ({ error: (e as Error).message }));
  return json({ task: { id: task.id, status: task.status }, payment });
});
