import nodemailer from "nodemailer"
import {humanizeAmount, zeroDecimalCurrencies} from "medusa-core-utils"
import Email, {EmailOptions} from "email-templates"

import {
  NotificationService,
  StoreService,
  OrderService,
  ReturnService,
  SwapService,
  CartService,
  LineItemService,
  ClaimService,
  FulfillmentService,
  FulfillmentProviderService,
  TotalsService,
  ProductVariantService,
  MedusaContainer,
  ReturnedData,
  Notification,
  Order,
  LineItem,
  GiftCardService,
  Discount,
  WithRequiredProperty, UserService, CustomerService
} from "@medusajs/medusa"
import {Transporter} from "nodemailer"

import {
  PluginConfig,
  OrderPlacedEventData,
  OrderCanceledEventData,
  OrderGiftCardCreatedEventData,
  OrderItemsReturnedEventData,
  OrderRequestedEventData,
  OrderShipmentCreatedEventData,
  SwapCreatedEventData,
  SwapShipmentCreatedEventData,
  SwapReceivedEventData,
  ClaimShipmentCreatedEventData,
  UserPasswordResetEventData,
  CustomerPasswordResetEventData,
  InviteCreatedEventData,
  RestockNotificationRestockedEventData,

  EnrichedOrderCanceledData, ProcessedLineItem, EnrichedOrderPlaceData
} from "./smtp_types";
import InviteService from "@medusajs/medusa/dist/services/invite";


export class SmtpService extends NotificationService {
  static identifier = "smtpService"

  protected readonly storeService_: StoreService;
  protected readonly orderService_: OrderService;
  protected readonly returnService_: ReturnService;
  protected readonly swapService_: SwapService;
  protected readonly cartService_: CartService;
  protected readonly lineItemService_: LineItemService;
  protected readonly claimService_: ClaimService;
  protected readonly fulfillmentService_: FulfillmentService;
  protected readonly fulfillmentProviderService_: FulfillmentProviderService;
  protected readonly totalsService_: TotalsService;
  protected readonly productVariantService_: ProductVariantService;
  protected readonly giftCardService_: GiftCardService;

  protected readonly options_: PluginConfig;
  protected readonly transporter: Transporter

  constructor(container: MedusaContainer, options: PluginConfig) {
    super({
      manager: container.resolve("manager"),
      logger: container.resolve("logger"),
      notificationRepository: container.resolve("notificationRepository"),
      notificationProviderRepository: container.resolve("notificationProviderRepository"),
    });

    this.options_ = options;
    this.fulfillmentProviderService_ = container.resolve("fulfillmentProviderService");
    this.storeService_ = container.resolve("storeService");
    this.lineItemService_ = container.resolve("lineItemService");
    this.orderService_ = container.resolve("orderService");
    this.cartService_ = container.resolve("cartService");
    this.claimService_ = container.resolve("claimService");
    this.returnService_ = container.resolve("returnService");
    this.swapService_ = container.resolve("swapService");
    this.fulfillmentService_ = container.resolve("fulfillmentService");
    this.totalsService_ = container.resolve("totalsService");
    this.productVariantService_ = container.resolve("productVariantService");
    this.giftCardService_ = container.resolve("giftCardService");

    this.transporter = nodemailer.createTransport(this.options_.transport)
  }

  async fetchAttachments(
    event: string,
    data: {
      return_request: WithRequiredProperty<Record<string, any>, "shipping_method" | "shipping_data" | "items">,
      order: Order
    },
    attachmentGenerator: any
  ) {
    switch (event) {
      case "swap.created":
      case "order.return_requested": {
        let attachments: {
          name: string,
          type: string,
          base64: string,
        }[] = []
        const {shipping_method, shipping_data} = data.return_request
        if (shipping_method) {
          const provider = shipping_method.shipping_option.provider_id

          const lbl = await this.fulfillmentProviderService_.retrieveDocuments(
            provider,
            shipping_data,
            "label"
          )

          attachments = attachments.concat(
            lbl.map((d: Record<string, unknown>) => ({
              name: "return-label",
              base64: d.base_64,
              type: d.type,
            }))
          )
        }

        // TODO: Ensure to registerAttachmentGenerator
        if (attachmentGenerator && attachmentGenerator.createReturnInvoice) {
          const base64 = await attachmentGenerator.createReturnInvoice(
            data.order,
            data.return_request.items
          )
          attachments.push({
            name: "invoice",
            base64,
            type: "application/pdf",
          })
        }

        return attachments
      }
      default:
        return []
    }
  }

  async fetchData(event: string, eventData: any, attachmentGenerator: unknown) {
    switch (event) {
      case OrderService.Events.CANCELED:
        return this.orderCanceledData(eventData, attachmentGenerator)
      case OrderService.Events.GIFT_CARD_CREATED:
        return this.gcCreatedData(eventData, attachmentGenerator)
      case OrderService.Events.ITEMS_RETURNED:
        return this.itemsReturnedData(eventData, attachmentGenerator)
      case OrderService.Events.PLACED:
        return this.orderPlacedData(eventData, attachmentGenerator)
      case OrderService.Events.RETURN_REQUESTED:
        return this.returnRequestedData(eventData, attachmentGenerator)
      case OrderService.Events.SHIPMENT_CREATED:
        return this.orderShipmentCreatedData(eventData, attachmentGenerator)


      case SwapService.Events.CREATED:
        return this.swapCreatedData(eventData, attachmentGenerator)
      case SwapService.Events.RECEIVED:
        return this.swapReceivedData(eventData, attachmentGenerator)
      case SwapService.Events.SHIPMENT_CREATED:
        return this.swapShipmentCreatedData(eventData, attachmentGenerator)

      case ClaimService.Events.SHIPMENT_CREATED:
        return this.claimShipmentCreatedData(eventData, attachmentGenerator)
      case GiftCardService.Events.CREATED:
        return this.gcCreatedData(eventData, attachmentGenerator)
      case UserService.Events.PASSWORD_RESET:
        return this.userPasswordResetData(eventData, attachmentGenerator)
      case CustomerService.Events.PASSWORD_RESET:
        return this.customerPasswordResetData(eventData, attachmentGenerator)
      case InviteService.Events.CREATED:
        return this.inviteData(eventData, attachmentGenerator)
      case "restock-notification.restocked":
        // see https://docs.medusajs.com/plugins/other/restock-notifications
        return await this.restockNotificationData(
          eventData,
          attachmentGenerator
        )
      default:
        return {}
    }
  }

  getTemplateNameForEvent(eventName: string) {
    return this.options_.templateMap[eventName] || false
  }

  async sendNotification(event: string, eventData: unknown, attachmentGenerator: unknown): Promise<ReturnedData> {
    const templateName = this.getTemplateNameForEvent(event)

    if (!templateName) {
      return {
        to: "",
        status: "noDataFound",
        data: {},
      }
    }

    const data = await this.fetchData(event, eventData, attachmentGenerator) as any
    const attachments = await this.fetchAttachments(
      event,
      data,
      attachmentGenerator
    )

    const sendOptions: EmailOptions = {
      template: templateName,
      message: {
        to: data.email,
      },
      locals: {
        data: data,
        env: process.env,
      },
    }

    if (attachments?.length) {
      sendOptions.message!.attachments = attachments.map((a) => {
        return {
          content: a.base64,
          filename: a.name,
          type: a.type,
          disposition: "attachment",
          contentId: a.name,
        }
      })
    }

    const email = new Email({
      message: {
        from: this.options_.fromEmail,
      },
      transport: this.transporter,
      views: {
        root: this.options_.emailTemplatePath,
      },
      send: true,
    })

    const status = await email
      .send(sendOptions)
      .then(() => "sent")
      .catch(() => "failed")
    delete sendOptions.message?.attachments
    return {
      to: sendOptions.message!.to as string,
      status,
      data: sendOptions.locals.data || {},
    }
  }

  async resendNotification(
    notification: Notification,
    config: Record<string, unknown>,
    attachmentGenerator: unknown
  ): Promise<ReturnedData> {
    const templateName = this.getTemplateNameForEvent(notification.event_name)
    if (!templateName) {
      return {
        to: notification.to,
        status: "noTemplateFound",
        data: notification.data,
      }
    }
    const sendOptions: EmailOptions = {
      template: templateName,
      message: {
        to: config.to as string || notification.to,
      },
      locals: {
        data: notification.data,
        env: process.env,
      },
    }

    const attachments = await this.fetchAttachments(
      notification.event_name,
      notification.data.dynamic_template_data as any,
      attachmentGenerator
    )

    sendOptions.message!.attachments = attachments.map((a) => {
      return {
        content: a.base64,
        filename: a.name,
        type: a.type,
        disposition: "attachment",
        contentId: a.name,
      }
    })

    const email = new Email({
      message: {
        from: this.options_.fromEmail,
      },
      transport: this.transporter,
      views: {
        root: this.options_.emailTemplatePath,
      },
      send: true,
    })
    const status = await email
      .send(sendOptions)
      .then(() => "sent")
      .catch(() => "failed")
    delete sendOptions.message!.attachments
    return {
      to: sendOptions.message!.to as string,
      status,
      data: sendOptions.locals.data || {},
    }
  }

  /**
   * Sends an email using smtp.
   */
  async sendEmail(
    options: {
      templateName: string,
      from?: string,
      to: string,
      data?: Record<string, unknown>,
    }
  ): Promise<ReturnedData> {
    const email = new Email({
      message: {
        from: options.from || this.options_.fromEmail,
      },
      transport: this.transporter,
      views: {
        root: this.options_.emailTemplatePath,
      },
      send: true,
    })
    const status = await email
      .send({
        template: options.templateName,
        message: {
          to: options.to,
        },
        locals: {
          data: options.data,
          env: process.env,
        },
      })
      .then(() => "sent")
      .catch(() => "failed")

    return {
      to: options.to,
      status,
      data: options,
    }
  }

  async orderShipmentCreatedData({id}: OrderShipmentCreatedEventData, attachmentGenerator?: unknown) {
    const order = await this.orderService_.retrieve(id, {
      select: [
        "shipping_total",
        "discount_total",
        "tax_total",
        "refunded_total",
        "gift_card_total",
        "subtotal",
        "total",
        "refundable_amount",
      ],
      relations: [
        "customer",
        "billing_address",
        "shipping_address",
        "discounts",
        "discounts.rule",
        "shipping_methods",
        "shipping_methods.shipping_option",
        "payments",
        "fulfillments",
        "returns",
        "gift_cards",
        "gift_card_transactions",
      ],
    })
    const locale = await this.extractLocale(order)

    // const shipment = await this.fulfillmentService_.retrieve(fulfillment_id, {
    //   relations: ['items', 'tracking_links'],
    // })


    return {
      locale,
      order,
      email: order.email,
      // date: shipment.shipped_at.toDateString(),
      // fulfillment: shipment,
      // tracking_links: shipment.tracking_links,
      // tracking_number: shipment.tracking_numbers.join(', '),
    }
  }

  async orderCanceledData(
    {id}: OrderCanceledEventData,
    attachmentGenerator?: unknown
  ): Promise<EnrichedOrderCanceledData> {
    const order = await this.orderService_.retrieve(id, {
      select: [
        "shipping_total",
        "discount_total",
        "tax_total",
        "refunded_total",
        "gift_card_total",
        "subtotal",
        "total",
      ],
      relations: [
        "customer",
        "billing_address",
        "shipping_address",
        "discounts",
        "discounts.rule",
        "shipping_methods",
        "shipping_methods.shipping_option",
        "payments",
        "fulfillments",
        "returns",
        "gift_cards",
        "gift_card_transactions",
      ],
    })

    const {
      subtotal,
      tax_total,
      discount_total,
      shipping_total,
      gift_card_total,
      total,
    } = order

    const taxRate = order.tax_rate ?? 0 / 100
    const currencyCode = order.currency_code.toUpperCase()

    const items = this.processItems_(order.items, taxRate, currencyCode)

    const discounts = order.discounts?.map((discount) => {
      return <Discount & {
        is_giftcard: boolean,
        code: string,
        descriptor: string,
      }>{
        ...discount,
        is_giftcard: false,
        code: discount.code,
        descriptor: `${discount.rule.value}${
          discount.rule.type === "percentage" ? "%" : ` ${currencyCode}`
        }`,
      }
    })

    const giftCards = order.gift_cards?.map((gc) => {
      return {
        is_giftcard: true,
        code: gc.code,
        descriptor: `${gc.value} ${currencyCode}`,
      }
    })

    discounts.concat(giftCards as typeof discounts)

    const locale = await this.extractLocale(order)

    return {
      ...order,
      locale,
      has_discounts: order.discounts.length,
      has_gift_cards: order.gift_cards.length,
      date: order.created_at.toDateString(),
      items,
      discounts,
      subtotal: `${this.humanPrice_(
        subtotal * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      gift_card_total: `${this.humanPrice_(
        gift_card_total * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      tax_total: `${this.humanPrice_(tax_total ?? 0, currencyCode)} ${currencyCode}`,
      discount_total: `${this.humanPrice_(
        discount_total * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      shipping_total: `${this.humanPrice_(
        shipping_total * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      total: `${this.humanPrice_(total, currencyCode)} ${currencyCode}`,
    }
  }

  async orderPlacedData(
    {id}: OrderPlacedEventData,
    attachmentGenerator?: unknown
  ): Promise<EnrichedOrderPlaceData> {
    const order = await this.orderService_.retrieve(id, {
      select: [
        "shipping_total",
        "discount_total",
        "tax_total",
        "refunded_total",
        "gift_card_total",
        "subtotal",
        "total",
      ],
      relations: [
        "customer",
        "billing_address",
        "shipping_address",
        "discounts",
        "discounts.rule",
        "shipping_methods",
        "shipping_methods.shipping_option",
        "payments",
        "fulfillments",
        "returns",
        "gift_cards",
        "gift_card_transactions",
      ],
    })

    const {tax_total, shipping_total, gift_card_total, total} = order

    const currencyCode = order.currency_code.toUpperCase()

    const items = await Promise.all(
      order.items.map(async (i) => {
        const totals = await this.totalsService_.getLineItemTotals(i, order, {
          include_tax: true,
          use_tax_lines: true,
        })
        return <LineItem & {
          totals: typeof totals,
          discounted_price: string,
          price: string,
        }>{
          ...i,
          thumbnail: this.normalizeThumbUrl_(i.thumbnail),
          totals,
          discounted_price: `${this.humanPrice_(
            totals.total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
          price: `${this.humanPrice_(
            totals.original_total / i.quantity,
            currencyCode
          )} ${currencyCode}`
        }
      })
    )

    const discounts = order.discounts?.map((discount) => {
      return <Discount & {
        is_giftcard: boolean,
        code: string,
        descriptor: string,
      }>{
        ...discount,
        is_giftcard: false,
        code: discount.code,
        descriptor: `${discount.rule.value}${
          discount.rule.type === "percentage" ? "%" : ` ${currencyCode}`
        }`,
      }
    })

    const giftCards = order.gift_cards?.map((gc) => {
      return {
        is_giftcard: true,
        code: gc.code,
        descriptor: `${gc.value} ${currencyCode}`,
      }
    })

    discounts.concat(giftCards as typeof discounts)

    const locale = await this.extractLocale(order)

    // Includes taxes in discount amount
    const discountTotal = items.reduce((acc, i) => {
      return acc + i.totals.original_total - i.totals.total
    }, 0)

    const discounted_subtotal = items.reduce((acc, i) => {
      return acc + i.totals.total
    }, 0)
    const subtotal = items.reduce((acc, i) => {
      return acc + i.totals.original_total
    }, 0)

    const subtotal_ex_tax = items.reduce((total, i) => {
      return total + i.totals.subtotal
    }, 0)

    return {
      ...order,
      locale,
      has_discounts: order.discounts.length,
      has_gift_cards: order.gift_cards.length,
      date: order.created_at.toDateString(),
      items,
      discounts,
      subtotal_ex_tax: `${this.humanPrice_(
        subtotal_ex_tax,
        currencyCode
      )} ${currencyCode}`,
      discounted_subtotal,
      subtotal: `${this.humanPrice_(subtotal, currencyCode)} ${currencyCode}`,
      gift_card_total: `${this.humanPrice_(
        gift_card_total,
        currencyCode
      )} ${currencyCode}`,
      tax_total: `${this.humanPrice_(tax_total ?? 0, currencyCode)} ${currencyCode}`,
      discount_total: `${this.humanPrice_(
        discountTotal,
        currencyCode
      )} ${currencyCode}`,
      shipping_total: `${this.humanPrice_(
        shipping_total,
        currencyCode
      )} ${currencyCode}`,
      total: `${this.humanPrice_(total, currencyCode)} ${currencyCode}`,
    }
  }

  async gcCreatedData({id}: OrderGiftCardCreatedEventData, attachmentGenerator?: unknown) {
    const giftCard = await this.giftCardService_.retrieve(id, {
      relations: ["region", "order"],
    })

    if (!giftCard.order) {
      return {}
    }

    const taxRate = giftCard.region.tax_rate / 100

    const locale = await this.extractLocale(giftCard.order)

    return {
      ...giftCard,
      locale,
      email: giftCard.order.email,
      display_value: giftCard.value * (1 + taxRate),
    }
  }

  async returnRequestedData(
    {id, return_id}: OrderRequestedEventData,
    attachmentGenerator?: unknown
  ) {
    // Fetch the return request
    const returnRequest = await this.returnService_.retrieve(return_id, {
      relations: [
        "items",
        "items.item",
        "items.item.tax_lines",
        "items.item.variant",
        "items.item.variant.product",
        "shipping_method",
        "shipping_method.tax_lines",
        "shipping_method.shipping_option",
      ],
    })

    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({item_id}) => item_id),
      },
      {relations: ["tax_lines"]}
    )

    // Fetch the order
    const order = await this.orderService_.retrieve(id, {
      select: ["total"],
      relations: [
        "items",
        "items.tax_lines",
        "discounts",
        "discounts.rule",
        "shipping_address",
        "returns",
      ],
    })

    const currencyCode = order.currency_code.toUpperCase()

    // Calculate which items are in the return
    const returnItems = await Promise.all(
      returnRequest.items.map(async (i) => {
        const found = items.find((oi) => oi.id === i.item_id)
        const totals = await this.totalsService_.getLineItemTotals(
          <LineItem>found,
          order,
          {
            include_tax: true,
            use_tax_lines: true,
          }
        )
        return {
          ...found ?? {},
          quantity: i.quantity,
          thumbnail: this.normalizeThumbUrl_(found?.thumbnail),
          totals,
          price: `${this.humanPrice_(
            totals.total,
            currencyCode
          )} ${currencyCode}`,
          tax_lines: totals.tax_lines
        }
      })
    )

    // Get total of the returned products
    const item_subtotal = returnItems.reduce(
      (acc, next) => acc + next.totals.total,
      0
    )

    // If the return has a shipping method get the price and any attachments
    let shippingTotal = 0
    if (returnRequest.shipping_method) {
      const base = returnRequest.shipping_method.price
      shippingTotal =
        base +
        returnRequest.shipping_method.tax_lines.reduce((acc, next) => {
          return Math.round(acc + base * (next.rate / 100))
        }, 0)
    }

    const locale = await this.extractLocale(order)

    return {
      locale,
      has_shipping: !!returnRequest.shipping_method,
      email: order.email,
      items: returnItems,
      subtotal: `${this.humanPrice_(
        item_subtotal,
        currencyCode
      )} ${currencyCode}`,
      shipping_total: `${this.humanPrice_(
        shippingTotal,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        returnRequest.refund_amount,
        currencyCode
      )} ${currencyCode}`,
      return_request: {
        ...returnRequest,
        refund_amount: `${this.humanPrice_(
          returnRequest.refund_amount,
          currencyCode
        )} ${currencyCode}`,
      },
      order,
      date: returnRequest.updated_at.toDateString(),
    }
  }

  async swapReceivedData({id}: SwapReceivedEventData, attachmentGenerator?: unknown) {
    const store = await this.storeService_.retrieve()
    const swap = await this.swapService_.retrieve(id, {
      relations: [
        "additional_items",
        "additional_items.tax_lines",
        "return_order",
        "return_order.items",
        "return_order.items.item",
        "return_order.shipping_method",
        "return_order.shipping_method.shipping_option",
      ],
    })

    const returnRequest = swap.return_order

    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({item_id}) => item_id),
      },
      {
        relations: ["tax_lines"],
      }
    )

    returnRequest.items = returnRequest.items.map((item) => {
      const found = items.find((i) => i.id === item.item_id)
      return {
        ...item,
        item: found as LineItem,
      }
    })

    const swapLink = store.swap_link_template ?? "".replace(
      /\{cart_id\}/,
      swap.cart_id
    )

    const order = await this.orderService_.retrieve(swap.order_id, {
      select: ["total"],
      relations: [
        "items",
        "discounts",
        "discounts.rule",
        "shipping_address",
        "swaps",
        "swaps.additional_items",
        "swaps.additional_items.tax_lines",
      ],
    })

    const cart = await this.cartService_.retrieve(swap.cart_id, {
      select: [
        "total",
        "tax_total",
        "discount_total",
        "shipping_total",
        "subtotal",
      ],
    })
    const currencyCode = order.currency_code.toUpperCase()

    const decoratedItems = await Promise.all(
      cart.items.map(async (i) => {
        const totals = await this.totalsService_.getLineItemTotals(i, cart, {
          include_tax: true,
        })

        return {
          ...i,
          totals,
          price: this.humanPrice_(
            totals.subtotal + totals.tax_total,
            currencyCode
          ),
        }
      })
    )

    const returnTotal = decoratedItems.reduce((acc, next) => {
      if (next.is_return) {
        return acc + -1 * (next.totals.subtotal + next.totals.tax_total)
      }
      return acc
    }, 0)

    const additionalTotal = decoratedItems.reduce((acc, next) => {
      if (!next.is_return) {
        return acc + next.totals.subtotal + next.totals.tax_total
      }
      return acc
    }, 0)

    const refundAmount = swap.return_order.refund_amount

    const locale = await this.extractLocale(order)

    return {
      locale,
      swap,
      order,
      return_request: returnRequest,
      date: swap.updated_at.toDateString(),
      swap_link: swapLink,
      email: order.email,
      items: decoratedItems.filter((di) => !di.is_return),
      return_items: decoratedItems.filter((di) => di.is_return),
      return_total: `${this.humanPrice_(
        returnTotal,
        currencyCode
      )} ${currencyCode}`,
      tax_total: `${this.humanPrice_(
        cart.total ?? 0,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        refundAmount,
        currencyCode
      )} ${currencyCode}`,
      additional_total: `${this.humanPrice_(
        additionalTotal,
        currencyCode
      )} ${currencyCode}`,
    }
  }

  async swapCreatedData({id}: SwapCreatedEventData, attachmentGenerator?: unknown) {
    const store = await this.storeService_.retrieve()
    const swap = await this.swapService_.retrieve(id, {
      relations: [
        "additional_items",
        "additional_items.tax_lines",
        "return_order",
        "return_order.items",
        "return_order.items.item",
        "return_order.shipping_method",
        "return_order.shipping_method.shipping_option",
      ],
    })

    const returnRequest = swap.return_order

    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({item_id}) => item_id),
      },
      {
        relations: ["tax_lines"],
      }
    )

    returnRequest.items = returnRequest.items.map((item) => {
      const found = items.find((i) => i.id === item.item_id)
      return {
        ...item,
        item: found as LineItem,
      }
    })

    const swapLink = store.swap_link_template ?? "".replace(
      /\{cart_id\}/,
      swap.cart_id
    )

    const order = await this.orderService_.retrieve(swap.order_id, {
      select: ["total"],
      relations: [
        "items",
        "items.tax_lines",
        "discounts",
        "discounts.rule",
        "shipping_address",
        "swaps",
        "swaps.additional_items",
        "swaps.additional_items.tax_lines",
      ],
    })

    const cart = await this.cartService_.retrieve(swap.cart_id, {
      select: [
        "total",
        "tax_total",
        "discount_total",
        "shipping_total",
        "subtotal",
      ],
    })
    const currencyCode = order.currency_code.toUpperCase()

    const decoratedItems = await Promise.all(
      cart.items.map(async (i) => {
        const totals = await this.totalsService_.getLineItemTotals(i, cart, {
          include_tax: true,
        })

        return {
          ...i,
          totals,
          tax_lines: totals.tax_lines,
          price: `${this.humanPrice_(
            totals.original_total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
          discounted_price: `${this.humanPrice_(
            totals.total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
        }
      })
    )

    const returnTotal = decoratedItems.reduce((acc, next) => {
      const {total} = next.totals
      if (next.is_return && next.variant_id) {
        return acc + -1 * total
      }
      return acc
    }, 0)

    const additionalTotal = decoratedItems.reduce((acc, next) => {
      const {total} = next.totals
      if (!next.is_return) {
        return acc + total
      }
      return acc
    }, 0)

    const refundAmount = swap.return_order.refund_amount

    const locale = await this.extractLocale(order)

    return {
      locale,
      swap,
      order,
      return_request: returnRequest,
      date: swap.updated_at.toDateString(),
      swap_link: swapLink,
      email: order.email,
      items: decoratedItems.filter((di) => !di.is_return),
      return_items: decoratedItems.filter((di) => di.is_return),
      return_total: `${this.humanPrice_(
        returnTotal,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        refundAmount,
        currencyCode
      )} ${currencyCode}`,
      additional_total: `${this.humanPrice_(
        additionalTotal,
        currencyCode
      )} ${currencyCode}`,
    }
  }

  async itemsReturnedData(data: OrderItemsReturnedEventData, attachmentGenerator: unknown) {
    return this.returnRequestedData(data, attachmentGenerator)
  }

  async swapShipmentCreatedData({id}: SwapShipmentCreatedEventData, attachmentGenerator?: unknown) {
    const swap = await this.swapService_.retrieve(id, {
      relations: [
        "shipping_address",
        "shipping_methods",
        "shipping_methods.tax_lines",
        "additional_items",
        "additional_items.tax_lines",
        "return_order",
        "return_order.items",
      ],
    })

    const order = await this.orderService_.retrieve(swap.order_id, {
      relations: [
        "region",
        "items",
        "items.tax_lines",
        "discounts",
        "discounts.rule",
        "swaps",
        "swaps.additional_items",
        "swaps.additional_items.tax_lines",
      ],
    })

    const cart = await this.cartService_.retrieve(swap.cart_id, {
      select: [
        "total",
        "tax_total",
        "discount_total",
        "shipping_total",
        "subtotal",
      ],
    })

    const returnRequest = swap.return_order
    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({item_id}) => item_id),
      },
      {
        relations: ["tax_lines"],
      }
    )

    // const taxRate = order.tax_rate??0 / 100
    const currencyCode = order.currency_code.toUpperCase()

    const returnItems = await Promise.all(
      swap.return_order.items.map(async (i) => {
        const found = items.find((oi) => oi.id === i.item_id)
        const totals = await this.totalsService_.getLineItemTotals(
          found as LineItem,
          cart,
          {include_tax: true}
        )

        return {
          ...found,
          thumbnail: this.normalizeThumbUrl_(found?.thumbnail),
          price: `${this.humanPrice_(
            totals.original_total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
          discounted_price: `${this.humanPrice_(
            totals.total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
          quantity: i.quantity,
        }
      })
    )

    const returnTotal = await this.totalsService_.getRefundTotal(
      order,
      returnItems as unknown as LineItem[]
    )

    const constructedOrder = {
      ...order,
      shipping_methods: swap.shipping_methods,
      items: swap.additional_items,
    }

    const additionalTotal = await this.totalsService_.getTotal(constructedOrder as Order)

    const refundAmount = swap.return_order.refund_amount

    // const shipment = await this.fulfillmentService_.retrieve(fulfillment_id, {
    //   relations: ['tracking_links'],
    // })

    const locale = await this.extractLocale(order)

    return {
      locale,
      swap,
      order,
      items: await Promise.all(
        swap.additional_items.map(async (i) => {
          const totals = await this.totalsService_.getLineItemTotals(i, cart, {
            include_tax: true,
          })

          return {
            ...i,
            thumbnail: this.normalizeThumbUrl_(i.thumbnail),
            price: `${this.humanPrice_(
              totals.original_total / i.quantity,
              currencyCode
            )} ${currencyCode}`,
            discounted_price: `${this.humanPrice_(
              totals.total / i.quantity,
              currencyCode
            )} ${currencyCode}`,
            quantity: i.quantity,
          }
        })
      ),
      date: swap.updated_at.toDateString(),
      email: order.email,
      tax_amount: `${this.humanPrice_(
        cart.tax_total ?? 0,
        currencyCode
      )} ${currencyCode}`,
      paid_total: `${this.humanPrice_(
        swap.difference_due,
        currencyCode
      )} ${currencyCode}`,
      return_total: `${this.humanPrice_(
        returnTotal,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        refundAmount,
        currencyCode
      )} ${currencyCode}`,
      additional_total: `${this.humanPrice_(
        additionalTotal,
        currencyCode
      )} ${currencyCode}`,
      // fulfillment: shipment,
      // tracking_links: shipment.tracking_links,
      // tracking_number: shipment.tracking_numbers.join(', '),
    }
  }

  async claimShipmentCreatedData(
    {id}: ClaimShipmentCreatedEventData,
    attachmentGenerator?: unknown
  ) {
    const claim = await this.claimService_.retrieve(id, {
      relations: ["order", "order.items", "order.shipping_address"],
    })

    // const shipment = await this.fulfillmentService_.retrieve(fulfillment_id, {
    //   relations: ['tracking_links'],
    // })

    const locale = await this.extractLocale(claim.order)

    return {
      locale,
      claim,
      email: claim.order.email,
      order: claim.order,
      // fulfillment: shipment,
      // tracking_links: shipment.tracking_links,
      // tracking_number: shipment.tracking_numbers.join(', '),
    }
  }

  async restockNotificationData(
    {variant_id, emails}: RestockNotificationRestockedEventData,
    attachmentGenerator?: unknown
  ) {
    const variant = await this.productVariantService_.retrieve(variant_id, {
      relations: ["product"],
    })

    let thumb
    if (variant.product.thumbnail) {
      thumb = this.normalizeThumbUrl_(variant.product.thumbnail)
    }

    return {
      product: {
        ...variant.product,
        thumbnail: thumb,
      },
      variant,
      variant_id,
      emails,
    }
  }

  userPasswordResetData(data: UserPasswordResetEventData, attachmentGenerator?: unknown) {
    return data
  }

  customerPasswordResetData(data: CustomerPasswordResetEventData, attachmentGenerator?: unknown) {
    return data
  }

  inviteData(data: InviteCreatedEventData, attachmentGenerator?: unknown) {
    return {email: data.user_email, ...data}
  }

  processItems_(items: LineItem[], taxRate: number, currencyCode: string): ProcessedLineItem[] {
    return items.map((i) => {
      return <ProcessedLineItem>{
        ...i,
        thumbnail: this.normalizeThumbUrl_(i.thumbnail),
        price: `${this.humanPrice_(
          i.unit_price * (1 + taxRate),
          currencyCode
        )} ${currencyCode}`,
      }
    })
  }

  humanPrice_(amount: number, currency: string) {
    if (!amount) {
      return "0.00"
    }

    const normalized = humanizeAmount(amount, currency)
    return normalized.toFixed(
      zeroDecimalCurrencies.includes(currency.toLowerCase()) ? 0 : 2
    )
  }

  normalizeThumbUrl_(url?: string | null) {
    if (!url) {
      return null
    }

    if (url.startsWith("http")) {
      return url
    } else if (url.startsWith("//")) {
      return `https:${url}`
    }
    return url
  }

  async extractLocale(fromOrder: Order) {
    if (fromOrder.cart_id) {
      try {
        const cart = await this.cartService_.retrieve(fromOrder.cart_id, {
          select: ["id", "context"],
        })

        if (cart.context && cart.context.locale) {
          return cart.context.locale
        }
      } catch (err) {
        console.log(err)
        console.warn("Failed to gather context for order")
        return null
      }
    }
    return null
  }
}

export default SmtpService
