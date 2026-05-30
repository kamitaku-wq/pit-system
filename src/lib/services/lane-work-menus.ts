import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { laneWorkMenus } from "@/lib/db/schema/lane_work_menus";
import { lanes } from "@/lib/db/schema/lanes";
import { workCategories } from "@/lib/db/schema/work_categories";
import { workMenus } from "@/lib/db/schema/work_menus";

export type LaneWorkMenuContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export type LaneWorkMenuSelectItem = {
  id: string;
  code: string;
  name: string;
  workCategoryId: string | null;
  workCategoryName: string | null;
  isActive: boolean;
};

const uuidRequired = z.string().uuid();
export const ReplaceLaneWorkMenusInput = z
  .object({
    workMenuIds: z.array(uuidRequired),
  })
  .strict();
export type ReplaceLaneWorkMenusInput = z.input<typeof ReplaceLaneWorkMenusInput>;

export class LaneNotFoundError extends Error {
  constructor(laneId: string) {
    super(`lane ${laneId} not found in this company`);
    this.name = "LaneNotFoundError";
  }
}

export class WorkMenuNotInCompanyError extends Error {
  constructor(invalidIds: string[]) {
    super(`work_menu ids do not belong to this company: ${invalidIds.join(",")}`);
    this.name = "WorkMenuNotInCompanyError";
  }
}

export async function listWorkMenuIdsByLaneId(
  laneId: string,
  ctx: LaneWorkMenuContext,
): Promise<string[]> {
  const rows = await ctx.db
    .select({ workMenuId: laneWorkMenus.workMenuId })
    .from(laneWorkMenus)
    .where(and(eq(laneWorkMenus.laneId, laneId), eq(laneWorkMenus.companyId, ctx.companyId)));
  return rows.map((r: { workMenuId: string }) => r.workMenuId);
}

export async function listWorkMenusForLaneSelect(
  ctx: LaneWorkMenuContext,
): Promise<LaneWorkMenuSelectItem[]> {
  const rows = await ctx.db
    .select({
      id: workMenus.id,
      code: workMenus.code,
      name: workMenus.name,
      workCategoryId: workMenus.workCategoryId,
      workCategoryName: workCategories.name,
      isActive: workMenus.isActive,
    })
    .from(workMenus)
    .leftJoin(workCategories, eq(workMenus.workCategoryId, workCategories.id))
    .where(and(eq(workMenus.companyId, ctx.companyId), isNull(workMenus.deletedAt)))
    .orderBy(asc(workCategories.name), asc(workMenus.name));
  return rows as LaneWorkMenuSelectItem[];
}

export type ReplaceLaneWorkMenusResult = {
  added: number;
  removed: number;
  kept: number;
};

export async function replaceLaneWorkMenus(
  laneId: string,
  input: ReplaceLaneWorkMenusInput,
  ctx: LaneWorkMenuContext,
): Promise<ReplaceLaneWorkMenusResult> {
  const parsed = ReplaceLaneWorkMenusInput.parse(input);
  const requested = Array.from(new Set(parsed.workMenuIds));

  // Drizzle transaction; nested savepoint when ctx.db is already a transaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await ctx.db.transaction(async (tx: any) => {
    const laneRows = await tx
      .select({ id: lanes.id })
      .from(lanes)
      .where(
        and(eq(lanes.id, laneId), eq(lanes.companyId, ctx.companyId), isNull(lanes.deletedAt)),
      )
      .limit(1);
    if (laneRows.length === 0) throw new LaneNotFoundError(laneId);

    if (requested.length > 0) {
      const validRows = await tx
        .select({ id: workMenus.id })
        .from(workMenus)
        .where(
          and(
            inArray(workMenus.id, requested),
            eq(workMenus.companyId, ctx.companyId),
            isNull(workMenus.deletedAt),
          ),
        );
      const validSet = new Set(validRows.map((r: { id: string }) => r.id));
      const invalid = requested.filter((id) => !validSet.has(id));
      if (invalid.length > 0) throw new WorkMenuNotInCompanyError(invalid);
    }

    const existingRows = (await tx
      .select({ workMenuId: laneWorkMenus.workMenuId })
      .from(laneWorkMenus)
      .where(eq(laneWorkMenus.laneId, laneId))) as Array<{ workMenuId: string }>;
    const existing = new Set<string>(existingRows.map((r) => r.workMenuId));
    const requestedSet = new Set<string>(requested);

    const toAdd = requested.filter((id) => !existing.has(id));
    const toRemove: string[] = Array.from(existing).filter((id) => !requestedSet.has(id));
    const kept = requested.filter((id) => existing.has(id)).length;

    if (toRemove.length > 0) {
      await tx
        .delete(laneWorkMenus)
        .where(
          and(eq(laneWorkMenus.laneId, laneId), inArray(laneWorkMenus.workMenuId, toRemove)),
        );
    }
    if (toAdd.length > 0) {
      await tx.insert(laneWorkMenus).values(
        toAdd.map((workMenuId) => ({
          companyId: ctx.companyId,
          laneId,
          workMenuId,
        })),
      );
    }

    return { added: toAdd.length, removed: toRemove.length, kept };
  });
}
