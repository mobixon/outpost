import { z } from 'zod';

// Instance administration: user accounts and invitations (superadmins only).

export const adminUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  isSuperadmin: z.boolean(),
  twoFactorEnabled: z.boolean(),
  hasPassword: z.boolean(),
  /** Ids of the linked external login providers. */
  providers: z.array(z.string()),
  disabled: z.boolean(),
  createdAt: z.string(),
  /** Last activity of any session; null when the account has no session. */
  lastSeenAt: z.string().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListSchema = z.object({
  users: z.array(adminUserSchema),
});

export const adminUserUpdateSchema = z
  .object({
    disabled: z.boolean().optional(),
    isSuperadmin: z.boolean().optional(),
  })
  .refine((body) => body.disabled !== undefined || body.isSuperadmin !== undefined, {
    message: 'Nothing to change',
  });

export const INVITATION_LIFETIMES_DAYS = [1, 7, 30] as const;
export type InvitationLifetime = (typeof INVITATION_LIFETIMES_DAYS)[number];

export const invitationCreateSchema = z.object({
  isSuperadmin: z.boolean(),
  expiresInDays: z.literal(INVITATION_LIFETIMES_DAYS),
  /** Reminder for the administrators, e.g. who the invitation is for. */
  note: z.string().trim().max(100).optional(),
});

export const invitationInfoSchema = z.object({
  id: z.string(),
  isSuperadmin: z.boolean(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(['pending', 'used', 'expired']),
  usedBy: z.string().nullable(),
});
export type InvitationInfo = z.infer<typeof invitationInfoSchema>;

export const invitationListSchema = z.object({
  invitations: z.array(invitationInfoSchema),
});

export const invitationCreatedSchema = z.object({
  invitation: invitationInfoSchema,
  /** The invitation link. It contains the token, which is stored only as a hash: shown once. */
  url: z.string(),
});
