import type {MedusaRequest, MedusaResponse} from "@medusajs/medusa";
import {validator} from "@medusajs/medusa"
import {MedusaError} from "@medusajs/utils"
import {IsString, IsObject, IsOptional} from "class-validator"

export class SendEmailReq {
  @IsString()
  templateName: string

  @IsOptional()
  @IsString()
  from?: string

  @IsString()
  to: string

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>
}

export class SendEmailRes {
  @IsString()
  to: boolean

  @IsString()
  status: "sent" | "failed"

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const validated = await validator(SendEmailReq, req.body)
  const smtpService = req.scope.resolve("smtpService")
  const rv = await smtpService.sendEmail(validated)
  res.sendStatus(200)
  res.json(rv as SendEmailRes)
}
