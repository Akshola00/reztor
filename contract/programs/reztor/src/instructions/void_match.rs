use anchor_lang::prelude::*;

// Stub. Accounts and logic per contract-spec.md §3.
#[derive(Accounts)]
pub struct VoidMatch {}

pub fn handle_void_match(_ctx: Context<VoidMatch>) -> Result<()> {
    Ok(())
}
