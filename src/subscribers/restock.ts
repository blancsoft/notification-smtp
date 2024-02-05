import {SubscriberArgs, SubscriberConfig} from "@medusajs/medusa";
import SmtpService from "../services/smtp";
import {RestockNotificationRestockedEventData} from "../services/smtp_types";

const RESTOCK_NOTIFICATION_RESTOCKED = "restock-notification.restocked";

export default async function restockEventHandler(
  {data, container}: SubscriberArgs<RestockNotificationRestockedEventData>
) {
  const smtpService: SmtpService = container.resolve("smtpService")

  const templateName = smtpService.getTemplateNameForEvent(
    RESTOCK_NOTIFICATION_RESTOCKED
  )

  if (!templateName) {
    return
  }

  const enrichedData = await smtpService.fetchData(
    RESTOCK_NOTIFICATION_RESTOCKED,
    data,
    null
  ) as { emails: string[] }

  if (!enrichedData.emails) {
    return
  }

  return await Promise.all(
    enrichedData.emails.map(async (to) => {
      return await smtpService.sendEmail({
        templateName,
        to,
        data: enrichedData
      })
    })
  )
}


export const config: SubscriberConfig = {
  event: RESTOCK_NOTIFICATION_RESTOCKED,
  context: {
    subscriberId: "smtp-restock-notification-handler",
  },
}
