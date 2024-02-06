import {Discount, LineItem, Order} from "@medusajs/medusa";
import {LineItemTaxLine} from "@medusajs/medusa/dist/models";


export type PluginConfig = {
  fromEmail: string,
  transport: { [key: string]: unknown } | string,
  emailTemplatePath: string,
  templateMap: { [key: string]: string },
}

type BaseEventData = {
  // string ID of order
  id: string,

  // no_notification indicates whether a notification should be sent
  no_notification?: boolean
}

export type OrderPlacedEventData = BaseEventData
export type OrderCanceledEventData = BaseEventData
export type OrderGiftCardCreatedEventData = Pick<BaseEventData, "id">
export type OrderItemsReturnedEventData = OrderRequestedEventData;
export type OrderRequestedEventData = BaseEventData & {
  // string ID of return
  return_id: string
}
export type OrderShipmentCreatedEventData = BaseEventData & {
  // string ID of fulfillment
  fulfillment_id: string,
}

export type GiftCardCreatedEventData = OrderGiftCardCreatedEventData;
export type SwapCreatedEventData = BaseEventData
export type SwapShipmentCreatedEventData = OrderShipmentCreatedEventData
export type SwapReceivedEventData = BaseEventData & {
  // string ID of order
  order_id: string,
}


export type ClaimShipmentCreatedEventData = OrderShipmentCreatedEventData

export type UserPasswordResetEventData = {
  // string email of user requesting to reset their password
  email: string,

  // token create to reset the password
  token: string
}
export type CustomerPasswordResetEventData = {
  // string ID of customer
  id: string,

  // string email of the customer
  email: string,

  // string first name of the customer
  first_name: string,

  // string last name of the customer
  last_name: string,

  // string reset password token
  token: string
}

export type InviteCreatedEventData = {
  // string ID of invite
  id: string,
  // string token generated to validate the invited user
  token: string,
  // string email of invited user
  user_email: string,
}

export type RestockNotificationRestockedEventData = {
  // The ID of the variant that has been restocked
  variant_id: string,

  // email addresses subscribed to the restocked variant
  emails: string[],
}

export type ProcessedLineItem = LineItem & {
  price: string,
}

export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] }

export type ChangePropertyType<T, Keys extends keyof T, NewType> = {
  [K in keyof T]: K extends Keys ? NewType : T[K];
};

export type EnrichedOrderCanceledData = ChangePropertyType<
  Order,
  "subtotal"
  | "gift_card_total"
  | "tax_total"
  | "discount_total"
  | "shipping_total"
  | "total",
  string> & {
  locale: unknown,
  has_discounts: boolean | number,
  has_gift_cards: boolean | number,
  date: string,
  items: ProcessedLineItem[],
  discounts: Discount[] & { is_giftcard: boolean, code: string, descriptor: string }[],
}

export type LineItemTotals = {
  unit_price: number;
  quantity: number;
  subtotal: number;
  tax_total: number;
  total: number;
  original_total: number;
  original_tax_total: number;
  tax_lines: LineItemTaxLine[];
  discount_total: number;
  raw_discount_total: number;
};

export type ProcessedLineItemTotals = ProcessedLineItem & {
  totals: LineItemTotals,
  discounted_price: string,
}
export type EnrichedOrderPlaceData = ChangePropertyType<
  EnrichedOrderCanceledData,
  "items",
  ProcessedLineItemTotals[]
> & { subtotal_ex_tax: string } & Record<string, any>
