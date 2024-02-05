import {SubscriberArgs, type SubscriberConfig, UserService} from "@medusajs/medusa";
import SmtpService from "../services/smtp";

export default async function userPasswordResetHandler (
  {data, container}: SubscriberArgs<Record<string, unknown>>
) {
  const smtpService: SmtpService = container.resolve("smtpService")
  await smtpService.sendNotification(
    UserService.Events.PASSWORD_RESET,
    data,
    null
  )
}

export const config: SubscriberConfig = {
  event: UserService.Events.PASSWORD_RESET,
  context: {
    subscriberId: "smtp-user-password-reset-handler",
  },
}
