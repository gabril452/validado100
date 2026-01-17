import { type NextRequest, NextResponse } from "next/server"
import { sendOrderToUtmfy, formatUtmfyDate, type UtmfyOrderRequest, type UtmfyTrackingParameters } from "@/lib/utmfy"
import type { BlackCatWebhookPayload } from "@/lib/blackcat"
import { getUtmParams, deleteUtmParams } from "@/lib/server-utm-store"

function extractTrackingParamsFromMetadata(metadata?: string): UtmfyTrackingParameters {
  const defaultParams: UtmfyTrackingParameters = {
    src: null,
    sck: null,
    utm_source: null,
    utm_campaign: null,
    utm_medium: null,
    utm_content: null,
    utm_term: null,
  }

  if (!metadata) return defaultParams

  try {
    const parsed = JSON.parse(metadata)
    const trackingParams = parsed.trackingParams || parsed

    return {
      src: trackingParams.src || null,
      sck: trackingParams.sck || null,
      utm_source: trackingParams.utm_source || null,
      utm_campaign: trackingParams.utm_campaign || null,
      utm_medium: trackingParams.utm_medium || null,
      utm_content: trackingParams.utm_content || null,
      utm_term: trackingParams.utm_term || null,
    }
  } catch (e) {
    console.error("[BlackCat Webhook] Erro ao parsear metadata:", e)
    return defaultParams
  }
}

function getTrackingParams(orderId: string, metadata?: string): UtmfyTrackingParameters {
  // Primeiro tenta recuperar do armazenamento do servidor (fonte primária)
  const serverParams = getUtmParams(orderId)

  if (serverParams) {
    console.log("[BlackCat Webhook] UTMs recuperados do servidor para orderId:", orderId)
    return {
      src: serverParams.src || null,
      sck: serverParams.sck || null,
      utm_source: serverParams.utm_source || null,
      utm_campaign: serverParams.utm_campaign || null,
      utm_medium: serverParams.utm_medium || null,
      utm_content: serverParams.utm_content || null,
      utm_term: serverParams.utm_term || null,
    }
  }

  // Fallback: tenta extrair do metadata
  console.log("[BlackCat Webhook] Usando fallback do metadata para orderId:", orderId)
  return extractTrackingParamsFromMetadata(metadata)
}

export async function POST(request: NextRequest) {
  try {
    // Verifica headers do webhook
    const webhookEvent = request.headers.get("X-Webhook-Event")
    const webhookSource = request.headers.get("X-Webhook-Source")

    console.log("===========================================")
    console.log("[BlackCat Webhook] RECEBIDO")
    console.log("[BlackCat Webhook] Event:", webhookEvent)
    console.log("[BlackCat Webhook] Source:", webhookSource)
    console.log("===========================================")

    const payload: BlackCatWebhookPayload = await request.json()
    console.log("[BlackCat Webhook] Payload:", JSON.stringify(payload))

    const { event, transactionId, externalReference, status, amount, customer, paidAt, fees, netAmount, metadata } =
      payload

    const orderId = externalReference || transactionId || ""
    const trackingParams = getTrackingParams(orderId, metadata)
    console.log("[BlackCat Webhook] Tracking Params finais:", JSON.stringify(trackingParams))

    // Processa apenas eventos de transação
    if (event === "transaction.created") {
      console.log("[BlackCat Webhook] Transação criada:", transactionId)
      // Evento de criação já é tratado no /api/pix/create
      return NextResponse.json({ success: true, message: "Evento recebido" })
    }

    if (event === "transaction.paid") {
      console.log("[BlackCat Webhook] Transação PAGA:", transactionId)

      try {
        const utmfyOrder: UtmfyOrderRequest = {
          orderId: orderId,
          platform: "papelaria-site",
          paymentMethod: "pix",
          status: "paid",
          createdAt: formatUtmfyDate(new Date()) || "",
          approvedDate: formatUtmfyDate(paidAt || new Date()) || "",
          refundedAt: null,
          customer: {
            name: customer?.name || "Cliente",
            email: customer?.email || "",
            phone: null,
            document: null,
            country: "BR",
          },
          products: [
            {
              id: "order",
              name: `Pedido ${orderId}`,
              planId: null,
              planName: null,
              quantity: 1,
              priceInCents: amount || 0,
            },
          ],
          trackingParameters: trackingParams,
          commission: {
            totalPriceInCents: amount || 0,
            gatewayFeeInCents: fees || 0,
            userCommissionInCents: netAmount || amount || 0,
            currency: "BRL",
          },
        }

        console.log("[BlackCat Webhook] Enviando evento paid para UTMify:", JSON.stringify(utmfyOrder))
        const utmfyResult = await sendOrderToUtmfy(utmfyOrder)
        console.log("[BlackCat Webhook] Resultado UTMify:", utmfyResult)

        deleteUtmParams(orderId)
      } catch (utmfyError) {
        console.error("[BlackCat Webhook] Erro ao enviar para UTMify:", utmfyError)
      }

      return NextResponse.json({ success: true, message: "Pagamento processado" })
    }

    if (event === "transaction.failed") {
      console.log("[BlackCat Webhook] Transação FALHOU:", transactionId, "Motivo:", payload.reason)

      // Envia evento de recusa para UTMify
      try {
        const utmfyOrder: UtmfyOrderRequest = {
          orderId: orderId,
          platform: "papelaria-site",
          paymentMethod: "pix",
          status: "refused",
          createdAt: formatUtmfyDate(new Date()) || "",
          approvedDate: null,
          refundedAt: null,
          customer: {
            name: customer?.name || "Cliente",
            email: customer?.email || "",
            phone: null,
            document: null,
            country: "BR",
          },
          products: [
            {
              id: "order",
              name: `Pedido ${orderId}`,
              planId: null,
              planName: null,
              quantity: 1,
              priceInCents: amount || 0,
            },
          ],
          trackingParameters: trackingParams,
          commission: {
            totalPriceInCents: amount || 0,
            gatewayFeeInCents: 0,
            userCommissionInCents: 0,
            currency: "BRL",
          },
        }

        console.log("[BlackCat Webhook] Enviando evento refused para UTMify")
        await sendOrderToUtmfy(utmfyOrder)

        deleteUtmParams(orderId)
      } catch (utmfyError) {
        console.error("[BlackCat Webhook] Erro ao enviar para UTMify:", utmfyError)
      }

      return NextResponse.json({ success: true, message: "Falha processada" })
    }

    // Eventos de saque - apenas log
    if (event.startsWith("withdrawal.")) {
      console.log("[BlackCat Webhook] Evento de saque:", event, payload.withdrawalId)
      return NextResponse.json({ success: true, message: "Evento de saque recebido" })
    }

    console.log("[BlackCat Webhook] Evento não tratado:", event)
    return NextResponse.json({ success: true, message: "Evento recebido" })
  } catch (error) {
    console.error("[BlackCat Webhook] Erro:", error)
    return NextResponse.json({ error: "Erro ao processar webhook" }, { status: 500 })
  }
}
