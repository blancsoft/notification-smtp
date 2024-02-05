import {
  ClaimService,
  CustomerService,
  GiftCardService,
  OrderService,
  SubscriberArgs,
  SubscriberConfig,
  SwapService,
} from "@medusajs/medusa";
import SmtpService from "../services/smtp";

const events: string[] = [
  OrderService.Events.SHIPMENT_CREATED,
  OrderService.Events.GIFT_CARD_CREATED,
  OrderService.Events.PLACED,
  OrderService.Events.CANCELED,
  OrderService.Events.ITEMS_RETURNED,
  OrderService.Events.RETURN_REQUESTED,
  SwapService.Events.SHIPMENT_CREATED,
  SwapService.Events.CREATED,
  ClaimService.Events.SHIPMENT_CREATED,
  CustomerService.Events.PASSWORD_RESET,
  GiftCardService.Events.CREATED,
]

export default async function customerRelatedEventHandler(
  {data, container}: SubscriberArgs<Record<string, unknown>>
) {
  const smtpService: SmtpService = container.resolve("smtpService")
  for (const ev of events) {
    await smtpService.sendNotification(ev, data, null)
  }
}

export const config: SubscriberConfig = {
  event: events,
  context: {
    subscriberId: "smtp-customer-related-handler",
  },
}
