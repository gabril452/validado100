// Black Cat Payments API Integration
// Docs: https://api.blackcatpagamentos.online/api

// ===== INTERFACES =====

export interface BlackCatDocument {
  number: string // CPF ou CNPJ (apenas números)
  type: "cpf" | "cnpj"
}

export interface BlackCatCustomer {
  name: string
  email: string
  phone: string // Apenas números
  document: BlackCatDocument
}

export interface BlackCatItem {
  title: string
  unitPrice: number // Em centavos
  quantity: number
  tangible?: boolean // true para produto físico, false para digital
}

export interface BlackCatShipping {
  name: string
  street: string
  number: string
  complement?: string
  neighborhood: string
  city: string
  state: string // UF - 2 caracteres
  zipCode: string // Apenas números
}

export interface BlackCatPixConfig {
  expiresInDays?: number // Default: 1
}

export interface BlackCatCreateSaleRequest {
  amount: number // Em centavos
  currency?: string // Default: BRL
  paymentMethod: "pix"
  items: BlackCatItem[]
  customer: BlackCatCustomer
  pix?: BlackCatPixConfig
  shipping?: BlackCatShipping // Obrigatório quando há produtos com tangible: true
  metadata?: string
  postbackUrl?: string
  externalRef?: string
}

export interface BlackCatPaymentData {
  qrCode: string
  qrCodeBase64: string
  copyPaste: string
  expiresAt: string
}

export interface BlackCatSaleResponse {
  success: boolean
  data?: {
    transactionId: string
    status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"
    paymentMethod: string
    amount: number
    netAmount: number
    fees: number
    invoiceUrl: string
    createdAt: string
    paymentData: BlackCatPaymentData
  }
  message?: string
  error?: string
}

export interface BlackCatStatusResponse {
  success: boolean
  data?: {
    transactionId: string
    status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"
    paymentMethod: string
    amount: number
    netAmount: number
    fees: number
    paidAt?: string
    endToEndId?: string
  }
  message?: string
  error?: string
}

export interface BlackCatSellerResponse {
  success: boolean
  data?: {
    name: string
    legalName: string
    cnpj: string
    logo: string | null
  }
  message?: string
  error?: string
}

// Webhook payload interfaces
export interface BlackCatWebhookPayload {
  event:
    | "transaction.created"
    | "transaction.paid"
    | "transaction.failed"
    | "withdrawal.created"
    | "withdrawal.completed"
    | "withdrawal.failed"
  timestamp: string
  transactionId?: string
  withdrawalId?: string
  externalReference?: string
  status: string
  amount: number
  netAmount?: number
  fees?: number
  paymentMethod?: string
  acquirer?: string
  acquirerTransactionId?: string
  paidAt?: string
  endToEndId?: string
  reason?: string
  customer?: {
    name: string
    email: string
  }
  metadata?: string
}

// ===== CONFIGURAÇÃO =====

const BLACKCAT_API_URL = "https://api.blackcatpagamentos.online/api"
const BLACKCAT_PUBLIC_KEY = process.env.BLACKCAT_PUBLIC_KEY || ""
const BLACKCAT_SECRET_KEY = process.env.BLACKCAT_SECRET_KEY || ""

// Headers padrão para todas as requisições
function getBlackCatHeaders(): HeadersInit {
  // Tenta usar a secret key como API key principal
  const apiKey = BLACKCAT_SECRET_KEY || BLACKCAT_PUBLIC_KEY

  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    Authorization: `Bearer ${apiKey}`,
    // Mantém os headers antigos também por compatibilidade
    "x-public-key": BLACKCAT_PUBLIC_KEY,
    "x-secret-key": BLACKCAT_SECRET_KEY,
  }
}

// ===== FUNÇÕES =====

/**
 * Cria uma nova venda via PIX na Black Cat
 */
export async function createBlackCatSale(request: BlackCatCreateSaleRequest): Promise<BlackCatSaleResponse> {
  console.log("[BlackCat] Criando venda PIX...")
  console.log("[BlackCat] Amount:", request.amount, "centavos")
  console.log("[BlackCat] Customer:", request.customer.name, request.customer.email)

  try {
    const response = await fetch(`${BLACKCAT_API_URL}/sales/create-sale`, {
      method: "POST",
      headers: getBlackCatHeaders(),
      body: JSON.stringify(request),
    })

    const data = await response.json()
    console.log("[BlackCat] Response status:", response.status)
    console.log("[BlackCat] Response:", JSON.stringify(data))

    if (!response.ok) {
      console.error("[BlackCat] Erro ao criar venda:", data)
      return {
        success: false,
        message: data.message || "Erro ao criar venda",
        error: data.error,
      }
    }

    return data as BlackCatSaleResponse
  } catch (error) {
    console.error("[BlackCat] Erro na requisição:", error)
    return {
      success: false,
      message: "Erro de conexão com a API",
      error: String(error),
    }
  }
}

/**
 * Consulta o status de uma transação
 */
export async function getBlackCatTransactionStatus(transactionId: string): Promise<BlackCatStatusResponse> {
  console.log("[BlackCat] Consultando status da transação:", transactionId)

  try {
    const response = await fetch(`${BLACKCAT_API_URL}/sales/${transactionId}/status`, {
      method: "GET",
      headers: getBlackCatHeaders(),
    })

    const data = await response.json()
    console.log("[BlackCat] Status response:", JSON.stringify(data))

    if (!response.ok) {
      console.error("[BlackCat] Erro ao consultar status:", data)
      return {
        success: false,
        message: data.message || "Erro ao consultar status",
        error: data.error,
      }
    }

    return data as BlackCatStatusResponse
  } catch (error) {
    console.error("[BlackCat] Erro na requisição:", error)
    return {
      success: false,
      message: "Erro de conexão com a API",
      error: String(error),
    }
  }
}

/**
 * Obtém dados do vendedor
 */
export async function getBlackCatSeller(): Promise<BlackCatSellerResponse> {
  console.log("[BlackCat] Obtendo dados do vendedor...")

  try {
    const response = await fetch(`${BLACKCAT_API_URL}/sales/seller`, {
      method: "GET",
      headers: getBlackCatHeaders(),
    })

    const data = await response.json()
    console.log("[BlackCat] Seller response:", JSON.stringify(data))

    if (!response.ok) {
      console.error("[BlackCat] Erro ao obter vendedor:", data)
      return {
        success: false,
        message: data.message || "Erro ao obter vendedor",
        error: data.error,
      }
    }

    return data as BlackCatSellerResponse
  } catch (error) {
    console.error("[BlackCat] Erro na requisição:", error)
    return {
      success: false,
      message: "Erro de conexão com a API",
      error: String(error),
    }
  }
}

/**
 * Mapeia status Black Cat para status interno
 */
export function mapBlackCatStatus(status: string): "pending" | "paid" | "cancelled" | "refunded" {
  switch (status.toUpperCase()) {
    case "PENDING":
      return "pending"
    case "PAID":
      return "paid"
    case "CANCELLED":
      return "cancelled"
    case "REFUNDED":
      return "refunded"
    default:
      return "pending"
  }
}

/**
 * Converte valor em reais para centavos
 */
export function toCents(value: number): number {
  return Math.round(value * 100)
}

/**
 * Converte valor em centavos para reais
 */
export function fromCents(value: number): number {
  return value / 100
}
