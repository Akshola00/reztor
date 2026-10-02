/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/reztor.json`.
 */
export type Reztor = {
  "address": "4hAFR3JFKmE5GkJFDSVUHB1LwcsZkQBszCq9kwFu5MHZ",
  "metadata": {
    "name": "reztor",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "createMatch",
      "discriminator": [
        107,
        2,
        184,
        145,
        70,
        142,
        17,
        165
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "matchAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "matchId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "matchAccount"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        },
        {
          "name": "players",
          "type": {
            "array": [
              "pubkey",
              4
            ]
          }
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "4hAFR3JFKmE5GkJFDSVUHB1LwcsZkQBszCq9kwFu5MHZ"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "mint",
          "type": "pubkey"
        },
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "buyInAmount",
          "type": "u64"
        },
        {
          "name": "creditsPerBuyIn",
          "type": "u32"
        },
        {
          "name": "rakeBps",
          "type": "u16"
        },
        {
          "name": "voidTimeoutSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "joinMatch",
      "discriminator": [
        244,
        8,
        47,
        130,
        192,
        59,
        179,
        44
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "matchAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "matchId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "matchAccount"
          ]
        },
        {
          "name": "playerTokenAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "matchAccount"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleMatch",
      "discriminator": [
        71,
        124,
        117,
        96,
        191,
        217,
        116,
        24
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "matchAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "matchId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "matchAccount"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "matchAccount"
              }
            ]
          }
        },
        {
          "name": "treasuryTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        },
        {
          "name": "unspentCredits",
          "type": {
            "array": [
              "u32",
              4
            ]
          }
        },
        {
          "name": "winnersMask",
          "type": "u8"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateConfigArgs"
            }
          }
        },
        {
          "name": "newAdmin",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "voidMatch",
      "discriminator": [
        108,
        111,
        216,
        72,
        110,
        46,
        217,
        140
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "The authority (any time) or a seated, joined player (after the timeout). Pays only the fee."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "which paid that rent at create_match. Need not sign."
          ],
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "matchAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "matchId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "matchAccount"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "matchAccount"
              }
            ]
          }
        },
        {
          "name": "treasuryTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "matchId",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "match",
      "discriminator": [
        236,
        63,
        169,
        38,
        15,
        56,
        196,
        162
      ]
    }
  ],
  "events": [
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "matchCreated",
      "discriminator": [
        151,
        176,
        11,
        24,
        34,
        225,
        227,
        16
      ]
    },
    {
      "name": "matchSettled",
      "discriminator": [
        243,
        201,
        134,
        151,
        193,
        131,
        223,
        150
      ]
    },
    {
      "name": "matchStarted",
      "discriminator": [
        69,
        179,
        169,
        249,
        67,
        123,
        163,
        173
      ]
    },
    {
      "name": "matchVoided",
      "discriminator": [
        6,
        29,
        114,
        181,
        85,
        228,
        104,
        243
      ]
    },
    {
      "name": "playerJoined",
      "discriminator": [
        39,
        144,
        49,
        106,
        108,
        210,
        183,
        38
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6001,
      "name": "invalidConfig",
      "msg": "Config violates an invariant"
    },
    {
      "code": 6002,
      "name": "duplicatePlayer",
      "msg": "Players must be non-default and distinct"
    },
    {
      "code": 6003,
      "name": "notSeated",
      "msg": "Signer is not seated in this match"
    },
    {
      "code": 6004,
      "name": "alreadyJoined",
      "msg": "Seat has already joined"
    },
    {
      "code": 6005,
      "name": "matchNotOpen",
      "msg": "Match is not open"
    },
    {
      "code": 6006,
      "name": "matchNotActive",
      "msg": "Match is not active"
    },
    {
      "code": 6007,
      "name": "invalidWinners",
      "msg": "Winners mask is invalid"
    },
    {
      "code": 6008,
      "name": "unspentExceedsBuyIn",
      "msg": "Unspent credits exceed the buy-in"
    },
    {
      "code": 6009,
      "name": "invalidTokenAccount",
      "msg": "Token account is invalid"
    },
    {
      "code": 6010,
      "name": "wrongRemainingAccountsCount",
      "msg": "Wrong number of remaining accounts"
    },
    {
      "code": 6011,
      "name": "voidTimeoutNotReached",
      "msg": "Void timeout has not been reached"
    },
    {
      "code": 6012,
      "name": "unauthorized",
      "msg": "Signer is not authorized"
    },
    {
      "code": 6013,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6014,
      "name": "vaultUnderfunded",
      "msg": "Vault holds less than the escrowed amount"
    },
    {
      "code": 6015,
      "name": "payoutMismatch",
      "msg": "Payouts do not sum to the vault balance"
    },
    {
      "code": 6016,
      "name": "invalidPlayer",
      "msg": "Player must not be the default pubkey"
    },
    {
      "code": 6017,
      "name": "invalidMint",
      "msg": "Mint does not match"
    },
    {
      "code": 6018,
      "name": "notJoined",
      "msg": "Seat has not joined"
    },
    {
      "code": 6019,
      "name": "invalidJoinedMask",
      "msg": "Joined mask is invalid"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "buyInAmount",
            "type": "u64"
          },
          {
            "name": "creditsPerBuyIn",
            "type": "u32"
          },
          {
            "name": "rakeBps",
            "type": "u16"
          },
          {
            "name": "voidTimeoutSecs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "docs": [
        "Carries the full config after the change, so listeners don't need to refetch."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "buyInAmount",
            "type": "u64"
          },
          {
            "name": "creditsPerBuyIn",
            "type": "u32"
          },
          {
            "name": "rakeBps",
            "type": "u16"
          },
          {
            "name": "voidTimeoutSecs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "match",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "buyInAmount",
            "type": "u64"
          },
          {
            "name": "creditsPerBuyIn",
            "type": "u32"
          },
          {
            "name": "rakeBps",
            "type": "u16"
          },
          {
            "name": "voidTimeoutSecs",
            "type": "i64"
          },
          {
            "name": "players",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "joinedMask",
            "type": "u8"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "matchStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "startedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "matchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "players",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "matchSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "payouts",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "treasuryAmount",
            "type": "u64"
          },
          {
            "name": "winnersMask",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "matchStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "matchStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "active"
          }
        ]
      }
    },
    {
      "name": "matchVoided",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "refundedSeatsMask",
            "type": "u8"
          },
          {
            "name": "byAuthority",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "playerJoined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "u64"
          },
          {
            "name": "seat",
            "type": "u8"
          },
          {
            "name": "player",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "updateConfigArgs",
      "docs": [
        "Each `None` leaves that field unchanged."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "mint",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "treasury",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "buyInAmount",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "creditsPerBuyIn",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "rakeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "voidTimeoutSecs",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          }
        ]
      }
    }
  ]
};
