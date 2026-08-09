import { z } from 'zod'
import {
  isFeatureInteractionId,
  type FeatureInteractionId
} from '../../../../shared/feature-interactions'

const FeatureInteractionRecord = z
  .object({
    firstInteractedAt: z.number().finite().nonnegative(),
    interactionCount: z.number().int().positive().optional()
  })
  .strict()
export const FeatureInteractions = z
  .record(z.string(), FeatureInteractionRecord)
  .superRefine((value, ctx) => {
    for (const id of Object.keys(value)) {
      if (!isFeatureInteractionId(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown feature interaction id: ${id}`,
          path: [id]
        })
      }
    }
  })
export const FeatureInteractionIdParam = z.custom<FeatureInteractionId>(isFeatureInteractionId, {
  message: 'Unknown feature interaction id'
})
export const PRBotAuthorOverrideUpdate = z
  .object({ author: z.string(), isBot: z.boolean() })
  .strict()
const GitHubProjectRef = z
  .object({
    owner: z.string(),
    ownerType: z.enum(['organization', 'user']),
    number: z.number().int(),
    host: z.string().optional()
  })
  .strict()
export const GitHubProjectSettings = z
  .object({
    pinned: z.array(GitHubProjectRef),
    recent: z.array(
      GitHubProjectRef.extend({
        lastOpenedAt: z.string()
      }).strict()
    ),
    lastViewByProject: z.record(z.string(), z.object({ viewId: z.string() }).strict()),
    activeProject: GitHubProjectRef.nullable()
  })
  .strict()
