import {
  type SubscriberConfig,
  type SubscriberArgs,
} from "@medusajs/medusa";

import {SmtpService} from "../services/smtp"
import InviteService from "@medusajs/medusa/dist/services/invite";

export default async function inviteCreatedHandler(
  {
    data,
    container,
  }: SubscriberArgs<Record<string, unknown>>
) {
  const smtpService: SmtpService = container.resolve("smtpService")
  await smtpService.sendNotification(
    "invite.created",
    data,
    null
  )
}

export const config: SubscriberConfig = {
  event: InviteService.Events.CREATED,
  context: {
    subscriberId: "smtp-invite-created-handler",
  },
}
