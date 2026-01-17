import { type NextRequest, NextResponse } from "next/server"
import { getBlackCatTransactionStatus, mapBlackCatStatus } from "@/lib/blackcat"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const transactionId = searchParams.get("transactionId")

    if (!transactionId) {
      return NextResponse.json({ error: "transactionId é obrigatório" }, { status: 400 })
    }

    console.log("[PIX Status] Consultando transação:", transactionId)

    const response = await getBlackCatTransactionStatus(transactionId)

    if (!response.success || !response.data) {
      console.error("[PIX Status] Erro:", response)
      return NextResponse.json({ error: response.message || "Erro ao consultar status" }, { status: 500 })
    }

    const { status, paidAt, endToEndId } = response.data
    const mappedStatus = mapBlackCatStatus(status)

    console.log("[PIX Status] Status:", status, "->", mappedStatus)

    return NextResponse.json({
      success: true,
      transactionId,
      status: mappedStatus,
      paidAt,
      endToEndId,
    })
  } catch (error) {
    console.error("[PIX Status] Erro:", error)
    return NextResponse.json({ error: "Erro interno ao consultar status" }, { status: 500 })
  }
}
