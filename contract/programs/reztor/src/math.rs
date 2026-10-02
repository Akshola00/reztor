//! Settlement math (contract-spec.md §3, divergence 8.6). Runs in integer credits exactly like
//! server/src/engine/settlement.ts and converts to base units only at the end. Pure: no accounts.

use crate::errors::ReztorError;

const BPS_DENOMINATOR: u128 = 10_000;
const MAX_WINNERS_MASK: u8 = 0b1111;
const MAX_JOINED_MASK: u8 = 0b1111;
pub const SEAT_BITS: [u8; 4] = [0b0001, 0b0010, 0b0100, 0b1000];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettlementAmounts {
    pub payouts: [u64; 4],
    pub treasury: u64,
}

pub fn compute_settlement(
    buy_in_amount: u64,
    credits_per_buy_in: u32,
    rake_bps: u16,
    unspent_credits: [u32; 4],
    winners_mask: u8,
    vault_amount: u64,
) -> Result<SettlementAmounts, ReztorError> {
    if winners_mask > MAX_WINNERS_MASK {
        return Err(ReztorError::InvalidWinners);
    }
    let n = winners_mask.count_ones();
    if n != 1 && n != 3 {
        return Err(ReztorError::InvalidWinners);
    }
    if unspent_credits.iter().any(|&u| u > credits_per_buy_in) {
        return Err(ReztorError::UnspentExceedsBuyIn);
    }

    let credits = u128::from(credits_per_buy_in);
    let buy_in = u128::from(buy_in_amount);
    let rate = buy_in
        .checked_div(credits)
        .ok_or(ReztorError::MathOverflow)?;

    let mut pot_c: u128 = 0;
    for &unspent in unspent_credits.iter() {
        let spent_c = credits
            .checked_sub(u128::from(unspent))
            .ok_or(ReztorError::MathOverflow)?;
        pot_c = pot_c.checked_add(spent_c).ok_or(ReztorError::MathOverflow)?;
    }
    let rake_c = pot_c
        .checked_mul(u128::from(rake_bps))
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(ReztorError::MathOverflow)?;
    let dist_c = pot_c.checked_sub(rake_c).ok_or(ReztorError::MathOverflow)?;
    let n = u128::from(n);
    let share_c = dist_c.checked_div(n).ok_or(ReztorError::MathOverflow)?;
    let dust_c = share_c
        .checked_mul(n)
        .and_then(|v| dist_c.checked_sub(v))
        .ok_or(ReztorError::MathOverflow)?;

    let escrowed = buy_in.checked_mul(4).ok_or(ReztorError::MathOverflow)?;
    let vault = u128::from(vault_amount);
    if vault < escrowed {
        return Err(ReztorError::VaultUnderfunded);
    }
    let excess = vault.checked_sub(escrowed).ok_or(ReztorError::MathOverflow)?;

    let mut payouts = [0u64; 4];
    let mut paid: u128 = 0;
    for ((payout, &unspent), bit) in payouts.iter_mut().zip(unspent_credits.iter()).zip(SEAT_BITS) {
        let won_c = if winners_mask & bit != 0 { share_c } else { 0 };
        let amount = u128::from(unspent)
            .checked_add(won_c)
            .and_then(|c| c.checked_mul(rate))
            .ok_or(ReztorError::MathOverflow)?;
        *payout = u64::try_from(amount).map_err(|_| ReztorError::MathOverflow)?;
        paid = paid.checked_add(amount).ok_or(ReztorError::MathOverflow)?;
    }
    let treasury = rake_c
        .checked_add(dust_c)
        .and_then(|c| c.checked_mul(rate))
        .and_then(|v| v.checked_add(excess))
        .ok_or(ReztorError::MathOverflow)?;

    if paid.checked_add(treasury).ok_or(ReztorError::MathOverflow)? != vault {
        return Err(ReztorError::PayoutMismatch);
    }

    Ok(SettlementAmounts {
        payouts,
        treasury: u64::try_from(treasury).map_err(|_| ReztorError::MathOverflow)?,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoidAmounts {
    pub refunds: [u64; 4],
    pub treasury: u64,
}

/// contract-spec.md §3 void_match: every joined seat gets its buy-in back; anything else in the
/// vault (tokens sent to it directly) goes to the treasury.
pub fn compute_void(
    buy_in_amount: u64,
    joined_mask: u8,
    vault_amount: u64,
) -> Result<VoidAmounts, ReztorError> {
    if joined_mask > MAX_JOINED_MASK {
        return Err(ReztorError::InvalidJoinedMask);
    }
    let buy_in = u128::from(buy_in_amount);
    let escrowed = buy_in
        .checked_mul(u128::from(joined_mask.count_ones()))
        .ok_or(ReztorError::MathOverflow)?;
    let vault = u128::from(vault_amount);
    if vault < escrowed {
        return Err(ReztorError::VaultUnderfunded);
    }
    let treasury = vault.checked_sub(escrowed).ok_or(ReztorError::MathOverflow)?;

    let mut refunds = [0u64; 4];
    let mut paid: u128 = 0;
    for (refund, bit) in refunds.iter_mut().zip(SEAT_BITS) {
        if joined_mask & bit != 0 {
            *refund = buy_in_amount;
            paid = paid.checked_add(buy_in).ok_or(ReztorError::MathOverflow)?;
        }
    }

    if paid.checked_add(treasury).ok_or(ReztorError::MathOverflow)? != vault {
        return Err(ReztorError::PayoutMismatch);
    }

    Ok(VoidAmounts {
        refunds,
        treasury: u64::try_from(treasury).map_err(|_| ReztorError::MathOverflow)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUY_IN: u64 = 12_000_000;
    const CREDITS: u32 = 1200;
    const RATE: u64 = 10_000;
    const ESCROWED: u64 = BUY_IN * 4;
    const CREW: u8 = 0b1101; // seats 0, 2, 3
    const IMPOSTOR: u8 = 0b0010; // seat 1

    fn settle(rake_bps: u16, unspent: [u32; 4], mask: u8, vault: u64) -> Result<SettlementAmounts, ReztorError> {
        compute_settlement(BUY_IN, CREDITS, rake_bps, unspent, mask, vault)
    }

    fn total(a: &SettlementAmounts) -> u64 {
        a.payouts.iter().sum::<u64>() + a.treasury
    }

    #[test]
    fn server_vectors() {
        let raw = include_str!("../../../tests/fixtures/settlement-vectors.json");
        let vectors: serde_json::Value = serde_json::from_str(raw).expect("vectors parse");
        let vectors = vectors.as_array().expect("vectors are an array");

        let u64_at = |v: &serde_json::Value| v.as_u64().expect("integer");
        let arr4 = |v: &serde_json::Value| -> [u64; 4] {
            let a = v.as_array().expect("array");
            assert_eq!(a.len(), 4);
            [u64_at(&a[0]), u64_at(&a[1]), u64_at(&a[2]), u64_at(&a[3])]
        };

        let (mut ran, mut skipped_void) = (0, 0);
        for v in vectors {
            let name = v["name"].as_str().expect("name");
            let winners = v["winners"].as_array().expect("winners");
            if winners.is_empty() {
                skipped_void += 1;
                continue;
            }
            let buy_in = u64_at(&v["buyIn"]) * 1_000_000; // whole SKR -> base units, 6 decimals
            let credits = u32::try_from(u64_at(&v["creditsPerBuyIn"])).unwrap();
            let rake = u16::try_from(u64_at(&v["rakeBps"])).unwrap();
            let unspent = arr4(&v["unspentCredits"]).map(|u| u32::try_from(u).unwrap());
            let mask = winners.iter().fold(0u8, |m, s| m | (1u8 << u64_at(s)));
            let rate = buy_in / u64::from(credits);
            assert_eq!(rate, RATE);

            let got = compute_settlement(buy_in, credits, rake, unspent, mask, buy_in * 4)
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));

            let exp = &v["expected"];
            let (refunds, payouts) = (arr4(&exp["refunds"]), arr4(&exp["payouts"]));
            for i in 0..4 {
                assert_eq!(got.payouts[i], (refunds[i] + payouts[i]) * RATE, "{name}: seat {i}");
            }
            assert_eq!(
                got.treasury,
                (u64_at(&exp["rake"]) + u64_at(&exp["dust"])) * RATE,
                "{name}: treasury"
            );
            println!("vector ok: {name} | payouts {:?} | treasury {}", got.payouts, got.treasury);
            ran += 1;
        }
        println!("{ran} settle vectors passed, {skipped_void} void vectors skipped");
        assert!(ran > 0, "no settle vectors were loaded");
    }

    #[test]
    fn server_void_vectors() {
        let raw = include_str!("../../../tests/fixtures/settlement-vectors.json");
        let vectors: serde_json::Value = serde_json::from_str(raw).expect("vectors parse");
        let mut ran = 0;
        for v in vectors.as_array().expect("vectors are an array") {
            if !v["winners"].as_array().expect("winners").is_empty() {
                continue;
            }
            let name = v["name"].as_str().expect("name");
            let buy_in = v["buyIn"].as_u64().expect("buyIn") * 1_000_000;
            // A void vector is a match that started, so all four seats had joined.
            let got = compute_void(buy_in, 0b1111, buy_in * 4)
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));
            let refunds = v["expected"]["refunds"].as_array().expect("refunds");
            for i in 0..4 {
                assert_eq!(got.refunds[i], refunds[i].as_u64().expect("refund") * RATE, "{name}: seat {i}");
            }
            assert_eq!(got.treasury, 0, "{name}: treasury");
            println!("void vector ok: {name} | refunds {:?} | treasury {}", got.refunds, got.treasury);
            ran += 1;
        }
        assert_eq!(ran, 2, "expected the fixture's 2 void vectors");
    }

    #[test]
    fn void_none_joined_empty_vault() {
        let a = compute_void(BUY_IN, 0, 0).unwrap();
        assert_eq!(a.refunds, [0; 4]);
        assert_eq!(a.treasury, 0);
    }

    #[test]
    fn void_two_of_four_joined() {
        let a = compute_void(BUY_IN, 0b0101, BUY_IN * 2).unwrap();
        assert_eq!(a.refunds, [BUY_IN, 0, BUY_IN, 0]);
        assert_eq!(a.treasury, 0);
    }

    #[test]
    fn void_excess_goes_to_treasury() {
        let a = compute_void(BUY_IN, 0b1010, BUY_IN * 2 + 777).unwrap();
        assert_eq!(a.refunds, [0, BUY_IN, 0, BUY_IN]);
        assert_eq!(a.treasury, 777);
        // Nobody joined but someone sent tokens: all of it to treasury.
        assert_eq!(compute_void(BUY_IN, 0, 5).unwrap().treasury, 5);
    }

    #[test]
    fn void_rejections() {
        assert!(matches!(compute_void(BUY_IN, 0b0111, BUY_IN * 3 - 1), Err(ReztorError::VaultUnderfunded)));
        assert!(matches!(compute_void(BUY_IN, 0b1_0000, BUY_IN), Err(ReztorError::InvalidJoinedMask)));
    }

    #[test]
    fn crew_win_full_spend_no_rake() {
        let a = settle(0, [0; 4], CREW, ESCROWED).unwrap();
        assert_eq!(a.payouts, [16_000_000, 0, 16_000_000, 16_000_000]);
        assert_eq!(a.treasury, 0);
    }

    #[test]
    fn crew_win_full_spend_5pct_rake() {
        let a = settle(500, [0; 4], CREW, ESCROWED).unwrap();
        assert_eq!(a.payouts, [15_200_000, 0, 15_200_000, 15_200_000]);
        assert_eq!(a.treasury, 2_400_000);
    }

    #[test]
    fn impostor_win_full_spend_5pct_rake() {
        let a = settle(500, [0; 4], IMPOSTOR, ESCROWED).unwrap();
        assert_eq!(a.payouts, [0, 45_600_000, 0, 0]);
        assert_eq!(a.treasury, 2_400_000);
    }

    #[test]
    fn nobody_spent() {
        let a = settle(500, [CREDITS; 4], CREW, ESCROWED).unwrap();
        assert_eq!(a.payouts, [BUY_IN; 4]);
        assert_eq!(a.treasury, 0);
    }

    #[test]
    fn partial_spend_dust_goes_to_treasury() {
        // pot 100 credits over 3 winners: share 33, dust 1.
        let a = settle(0, [1100, 1200, 1200, 1200], CREW, ESCROWED).unwrap();
        assert_eq!(a.payouts, [(1100 + 33) * RATE, 1200 * RATE, (1200 + 33) * RATE, (1200 + 33) * RATE]);
        assert_eq!(a.treasury, RATE);
        assert_eq!(total(&a), ESCROWED);
    }

    #[test]
    fn vault_excess_goes_to_treasury() {
        let base = settle(500, [300, 0, 900, 1200], CREW, ESCROWED).unwrap();
        let extra = settle(500, [300, 0, 900, 1200], CREW, ESCROWED + 777).unwrap();
        assert_eq!(extra.payouts, base.payouts);
        assert_eq!(extra.treasury, base.treasury + 777);
    }

    #[test]
    fn rejections() {
        let u = [0; 4];
        for mask in [0, 0b0011, 0b1111, 0b1_0000, 0b1_0111] {
            assert!(matches!(settle(0, u, mask, ESCROWED), Err(ReztorError::InvalidWinners)), "mask {mask:#b}");
        }
        assert!(matches!(
            settle(0, [0, 0, 1201, 0], CREW, ESCROWED),
            Err(ReztorError::UnspentExceedsBuyIn)
        ));
        assert!(matches!(settle(0, u, CREW, ESCROWED - 1), Err(ReztorError::VaultUnderfunded)));
    }

    #[test]
    fn property_sums_and_equal_shares() {
        // Fixed-seed LCG (Knuth MMIX constants); no extra crates.
        let mut state: u64 = 0x5EED_2E27_0000_0001;
        let mut next = |bound: u64| -> u64 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (state >> 33) % bound
        };
        const VALID_MASKS: [u8; 8] = [0b0001, 0b0010, 0b0100, 0b1000, 0b0111, 0b1011, 0b1101, 0b1110];

        for _ in 0..20_000 {
            let credits = u32::try_from(1 + next(5000)).unwrap();
            let rate = 1 + next(1_000_000);
            let buy_in = rate * u64::from(credits);
            let rake = u16::try_from(next(1001)).unwrap();
            let unspent = [0; 4].map(|_: u32| u32::try_from(next(u64::from(credits) + 1)).unwrap());
            let mask = VALID_MASKS[usize::try_from(next(8)).unwrap()];
            let vault = buy_in * 4 + next(1_000_000);

            let a = compute_settlement(buy_in, credits, rake, unspent, mask, vault).unwrap();
            assert_eq!(total(&a), vault);

            let mut share = None;
            for i in 0..4 {
                let refund = u64::from(unspent[i]) * rate;
                if mask & SEAT_BITS[i] != 0 {
                    let s = a.payouts[i] - refund;
                    assert_eq!(*share.get_or_insert(s), s, "unequal winner shares");
                } else {
                    assert_eq!(a.payouts[i], refund, "loser got more than their refund");
                }
            }
        }
    }
}
