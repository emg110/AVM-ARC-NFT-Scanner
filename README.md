# ARC74 based ARC72 NFT Indexer API / Scanner Module

### Jan 2024 Voi Hackathon Team Project API Repository

**Team:**
- MG
- FlippingAlgos
- EasyTiger


## Table of Contents
- [ARC74 based ARC72 NFT Indexer API / Scanner Module](#arc74-based-arc72-nft-indexer-api--scanner-module)
    - [Jan 2024 Voi Hackathon Team Project API Repository](#jan-2024-voi-hackathon-team-project-api-repository)
  - [Table of Contents](#table-of-contents)
  - [Introduction](#introduction)
  - [Tech stack](#tech-stack)
  - [General flow](#general-flow)
  - [Architecture Note](#architecture-note)
  - [Documentation](#documentation)
  - [References](#references)

## Introduction

This API interface complies to [ARC74](https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0074.md) to enable efficient querying of [ARC72](https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0072.md) NFT assets on AVM networks (TESTNET for now).
Adhering to [ARC74], [ARC73] and [ARC72] this ARC NFT Indexer implements a 3 layer architecture:
- Presenter API (this repo)
- [Indexing API](https://github.com/emg110/AVM-ARC-NFT-Indexer)
- [Scanner API](https://github.com/emg110/AVM-ARC-NFT-Scanner)

```mermaid
graph TD
    AlgodAPI[Algod API]
    Scanner --> AlgodAPI[Algod API]
    Scanner --> Indexing[Indexing Serverless API]
    Presenter --> Indexing[Indexing Serverless API]
    User --> Presenter[Presenter API]

    style AlgodAPI fill:#f9f,stroke:#000,stroke-width:2px
    style Scanner fill:#bbf,stroke:#000,stroke-width:2px
    style Indexing fill:#f9d,stroke:#000,stroke-width:2px
    style Presenter fill:#bfb,stroke:#000,stroke-width:2px
    style User fill:#fdb,stroke:#000,stroke-width:2px
  ```
  Each entity in this chart plays a specific role in the system, forming a structured flow of operations from data retrieval to user interaction and delivery.

- Algod API: The starting point of the data flow, providing round based blocks and events data.
- Scanner NodeJS Module: Processes data from Algod API, scanning for ARC72 contracts.
- Indexing Serverless API: Receives and indexes data from the Scanner.
- Presenter API: Retrieves indexed data and prepares it for user interaction.
- User: The end-user who interacts with the system through the Presenter API ([ARC74]).

## Tech stack


- Cloudflare: Infrastructure used for Indexing API
- Cloudflare D1: SQL storage (SQLite API) 
- Cloudflare KV: KeyValue storage for internal parameters!
- NodeJS: Platform for Scanner module
- PM2: Reliable running agent for NodeJS. Used to reliably running Scanner module!

Note : Algorand or VOI node REST API needs to be available too! No AVM indexer API is needed!

## General flow

```mermaid
flowchart LR
    AlgodAPI[Algod API]
    Scanner[Scanner NodeJS Module]
    Indexing[Indexing Serverless API]
    Presenter[Presenter API]
    User[User]
    CloudflareD1[Cloudflare D1 SQL Instance]

    Scanner -->|Scans rounds & events| AlgodAPI
    Scanner -->|Calls POST methods with batch payload| Indexing
    Indexing -->|Writes data to| CloudflareD1
    CloudflareD1 -->|Reads data from| Indexing
    Presenter -->|Calls GET methods| Indexing
    User -->|Calls ARC74 GET methods| Presenter

    style AlgodAPI fill:#f9f,stroke:#000,stroke-width:2px
    style Scanner fill:#bbf,stroke:#000,stroke-width:2px
    style Indexing fill:#fbf,stroke:#000,stroke-width:2px
    style Presenter fill:#bfb,stroke:#000,stroke-width:2px
    style User fill:#fbb,stroke:#000,stroke-width:2px
    style CloudflareD1 fill:#ff9,stroke:#000,stroke-width:2px
  ```
## Architecture Note
The reason for using two separated APIs is for separation of concerns in order to achieve better results in 48 hours time window of Hackathon!

The presenter API sits in FrontEnd role and deals with rate limiting, front gate security and stuff like that while leaves the options for backend API and how it communicates data to frontend, open!

The endpoints between Presenter and Indexing APIs use "POST" method but identical endpoint URL as [ARC74] describes! Data is transferred as JSON and "Content-Type" and "Accept" headers are both set to "application/json".

## Documentation
API is documented and tested using Swagger/OpenAPI UI: https://voi-nft-indexer-api.vercel.app

## References

William G Hatch, "ARC-72: Algorand Smart Contract NFT Specification," Algorand Requests for Comments, no. 72, January 2023. [Online serial]. Available: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0072.md.

William G Hatch, "ARC-73: Algorand Interface Detection Spec," Algorand Requests for Comments, no. 73, January 2023. [Online serial]. Available: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0073.md.

William G Hatch, "ARC-74: NFT Indexer API," Algorand Requests for Comments, no. 74, February 2023. [Online serial]. Available: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0074.md
