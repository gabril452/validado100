import { type NextRequest, NextResponse } from "next/server"
import {
  createBlackCatSale,
  toCents,
  type BlackCatCreateSaleRequest,
  type BlackCatItem,
  type BlackCatShipping,
} from "@/lib/blackcat"
import { sendOrderToUtmfy, formatUtmfyDate, type UtmfyOrderRequest } from "@/lib/utmfy"
import { saveUtmParams } from "@/lib/server-utm-store"

// Gera ID único para o pedido
function generateOrderId(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `PED-${timestamp}-${random}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log("[PIX Create] Recebendo requisição:", JSON.stringify(body))

    const { customer, address, items, total, shipping, trackingParams } = body

    // Validações básicas
    if (!customer || !customer.name || !customer.email || !customer.cpf || !customer.phone) {
      return NextResponse.json({ error: "Dados do cliente incompletos" }, { status: 400 })
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Nenhum item no pedido" }, { status: 400 })
    }

    if (!total || total <= 0) {
      return NextResponse.json({ error: "Valor total inválido" }, { status: 400 })
    }

    const orderId = generateOrderId()

    if (trackingParams) {
      saveUtmParams(orderId, {
        src: trackingParams.src || null,
        sck: trackingParams.sck || null,
        utm_source: trackingParams.utm_source || null,
        utm_campaign: trackingParams.utm_campaign || null,
        utm_medium: trackingParams.utm_medium || null,
        utm_content: trackingParams.utm_content || null,
        utm_term: trackingParams.utm_term || null,
      })
      console.log("[PIX Create] UTMs salvos no servidor para orderId:", orderId)
    }

    const amountInCents = toCents(total)

    // Monta os itens para Black Cat
    const blackCatItems: BlackCatItem[] = items.map((item: { name: string; price: number; quantity: number }) => ({
      title: item.name,
      unitPrice: toCents(item.price),
      quantity: item.quantity,
      tangible: true, // Produtos físicos
    }))

    // Adiciona frete como item se houver
    if (shipping && shipping.price > 0) {
      blackCatItems.push({
        title: `Frete - ${shipping.name}`,
        unitPrice: toCents(shipping.price),
        quantity: 1,
        tangible: false,
      })
    }

    // Monta endereço de entrega
    const blackCatShipping: BlackCatShipping = {
      name: customer.name,
      street: address.street,
      number: address.number,
      complement: address.complement || "",
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      zipCode: address.cep?.replace(/\D/g, "") || "",
    }

    // Monta requisição para Black Cat
    const blackCatRequest: BlackCatCreateSaleRequest = {
      amount: amountInCents,
      currency: "BRL",
      paymentMethod: "pix",
      items: blackCatItems,
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone.replace(/\D/g, ""),
        document: {
          number: customer.cpf.replace(/\D/g, ""),
          type: "cpf",
        },
      },
      shipping: blackCatShipping,
      pix: {
        expiresInDays: 1,
      },
      postbackUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://seu-dominio.com"}/api/webhook/blackcat`,
      externalRef: orderId,
      metadata: JSON.stringify({
        orderId,
        trackingParams,
      }),
    }

    console.log("[PIX Create] Enviando para Black Cat:", JSON.stringify(blackCatRequest))

    // Cria venda na Black Cat
    const blackCatResponse = await createBlackCatSale(blackCatRequest)

    if (!blackCatResponse.success || !blackCatResponse.data) {
      console.error("[PIX Create] Erro Black Cat:", blackCatResponse)
      return NextResponse.json({ error: blackCatResponse.message || "Erro ao criar pagamento PIX" }, { status: 500 })
    }

    const { transactionId, paymentData } = blackCatResponse.data

    try {
      const utmfyOrder: UtmfyOrderRequest = {
        orderId: orderId,
        platform: "papelaria-site",
        paymentMethod: "pix",
        status: "waiting_payment",
        createdAt: formatUtmfyDate(new Date()) || "",
        approvedDate: null,
        refundedAt: null,
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone?.replace(/\D/g, "") || null,
          document: customer.cpf?.replace(/\D/g, "") || null,
          country: "BR",
        },
        products: items.map((item: { id: string; name: string; price: number; quantity: number }) => ({
          id: item.id || "product",
          name: item.name,
          planId: null,
          planName: null,
          quantity: item.quantity,
          priceInCents: toCents(item.price),
        })),
        trackingParameters: {
          src: trackingParams?.src || null,
          sck: trackingParams?.sck || null,
          utm_source: trackingParams?.utm_source || null,
          utm_campaign: trackingParams?.utm_campaign || null,
          utm_medium: trackingParams?.utm_medium || null,
          utm_content: trackingParams?.utm_content || null,
          utm_term: trackingParams?.utm_term || null,
        },
        commission: {
          totalPriceInCents: amountInCents,
          gatewayFeeInCents: blackCatResponse.data.fees || 0,
          userCommissionInCents: blackCatResponse.data.netAmount || amountInCents,
          currency: "BRL",
        },
      }

      console.log("[PIX Create] Enviando evento waiting_payment para UTMify:", JSON.stringify(utmfyOrder))
      const utmfyResult = await sendOrderToUtmfy(utmfyOrder)
      console.log("[PIX Create] Resultado UTMify:", utmfyResult)
    } catch (utmfyError) {
      console.error("[PIX Create] Erro ao enviar para UTMify:", utmfyError)
      // Não falha a requisição se UTMify falhar
    }

    // Retorna dados do PIX
    return NextResponse.json({
      success: true,
      orderId,
      transactionId,
      pix: {
        qrcode: paymentData.copyPaste || paymentData.qrCode,
        qrCodeBase64: paymentData.qrCodeBase64,
        expiresAt: paymentData.expiresAt,
      },
    })
  } catch (error) {
    console.error("[PIX Create] Erro:", error)
    return NextResponse.json({ error: "Erro interno ao processar pagamento" }, { status: 500 })
  }
}
