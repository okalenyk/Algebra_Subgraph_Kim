/* eslint-disable prefer-const */
import { ONE_BD, ZERO_BD, ZERO_BI } from './constants'
import { Bundle, Pool, Token } from './../types/schema'
import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { exponentToBigDecimal, safeDiv } from '../utils/index'

const WMatic_ADDRESS = '0x4200000000000000000000000000000000000006'
const USDC_WMatic_03_POOL = '0x468cc91df6f669cae6cdce766995bd7874052fbc'

// token where amounts should contribute to tracked volume and liquidity
// usually tokens that many tokens are paired with s
export let WHITELIST_TOKENS: string[] = [
  '0x4200000000000000000000000000000000000006', // WMATIC
  '0xd988097fb8612cc24eec14542bc03424c656005f', // USDC
  '0xf0f161fda2712db8b566946122a5af183995e2ed', // USDT
  '0xcdd475325d6f564d27247d1dddbb0dac6fa0a5cf', // WBTC
  '0x3e7ef8f50246f725885102e8238cbba33f276747', // UNI
  '0x9e5aac1ba1a2e6aed6b32689dfcf62a509ca96f3', // SNX
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // LINK
  '0xe7798f023fc62146e8aa1b36da45fb70855a77ea', // DAI
  '0xd08a2917653d4e460893203471f0000826fb4034', // BAL
  '0x7c6b91d9be155a6db01f749217d76ff02a7227f2', // AAVE
  '0x12d8ce035c5de3ce39b1fdd4c1d5a745eaba3b8c', // ankrETH
  '0x2416092f143378750bb29b79ed961ab195cceea5', // ezETH
  '0x028227c4dd1e5419d11bb6fa6e661920c519d4f5', // weETH'
  '0x80137510979822322193fc997d400d5a6c747bf7', // STONE'
  '0x9e0d7d79735e1c63333128149c7b616a0dc0bbdb', // pxETH',
]

let MINIMUM_Matic_LOCKED = BigDecimal.fromString('0.01')

let Q192 = Math.pow(2, 192)

let STABLE_COINS: string[] = [
  '0xd988097fb8612cc24eec14542bc03424c656005f', // USDC
  '0xf0f161fda2712db8b566946122a5af183995e2ed' // SUDT
]


export function priceToTokenPrices(price: BigInt, token0: Token, token1: Token): BigDecimal[] {
  let num = price.times(price).toBigDecimal()
  let denom = BigDecimal.fromString(Q192.toString())
  let price1 = num
    .div(denom)
    .times(exponentToBigDecimal(token0.decimals))
    .div(exponentToBigDecimal(token1.decimals))

  let price0 = safeDiv(BigDecimal.fromString('1'), price1)
  return [price0, price1]
}

export function getEthPriceInUSD(): BigDecimal {
  let usdcPool = Pool.load(USDC_WMatic_03_POOL) // dai is token0
  if (usdcPool !== null) {
    return usdcPool.token1Price
  } else {
    return ZERO_BD
  }
} 


/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived Matic (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WMatic_ADDRESS) {
    return ONE_BD
  }
  let whiteList = token.whitelistPools
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityMatic = ZERO_BD
  let priceSoFar = ZERO_BD
  let bundle = Bundle.load('1')

  // hardcoded fix for incorrect rates
  // if whitelist includes token - get the safe price
  if (STABLE_COINS.includes(token.id)) {
    priceSoFar = safeDiv(ONE_BD, bundle!.maticPriceUSD)
  } else {
  for (let i = 0; i < whiteList.length; ++i) {
    let poolAddress = whiteList[i]
    let pool = Pool.load(poolAddress)!
    if (pool.liquidity.gt(ZERO_BI)) {

      if (pool.token0 == token.id) {
        // whitelist token is token1
        let token1 = Token.load(pool.token1)!
        // get the derived Matic in pool
        let maticLocked = pool.totalValueLockedToken1.times(token1.derivedMatic)
        if (maticLocked.gt(largestLiquidityMatic) && maticLocked.gt(MINIMUM_Matic_LOCKED)) {
          largestLiquidityMatic = maticLocked
          // token1 per our token * Eth per token1
          priceSoFar = pool.token1Price.times(token1.derivedMatic as BigDecimal)
        }
      }
      if (pool.token1 == token.id) {
        let token0 = Token.load(pool.token0)!
        // get the derived Matic in pool
        let maticLocked = pool.totalValueLockedToken0.times(token0.derivedMatic)
        if (maticLocked.gt(largestLiquidityMatic) && maticLocked.gt(MINIMUM_Matic_LOCKED)) {
          largestLiquidityMatic = maticLocked
          // token0 per our token * Matic per token0
          priceSoFar = pool.token0Price.times(token0.derivedMatic as BigDecimal)
        }
      }
    }
  }
}
  return priceSoFar // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0USD = token0.derivedMatic.times(bundle.maticPriceUSD)
  let price1USD = token1.derivedMatic.times(bundle.maticPriceUSD)

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.includes(token0.id) && !WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount1.times(price1USD).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked amount is 0
  return ZERO_BD
}
