# Pulsar Frontend — Payer Dashboard

React + Vite UI for payers to view payment history and track refund status.

## Setup

```bash
cd frontend
cp .env.example .env        # fill in CONTRACT_ID
npm install
npm run dev
```

## Component catalogue (Storybook)

```bash
npm install
npm run storybook
```

Opens an interactive catalogue of the UI components at `localhost:6006`,
including stories for `CopyButton`, `ContractCallStatus`
(Spinner/ErrorMessage/SuccessBanner), and `NotificationCenter`. Config lives
in `.storybook/`; add a `*.stories.tsx` file next to a component to document
it.

## Features
- Freighter wallet connection
- Paginated payment history table (cursor-based)
- Filter by status, amount range
- Sort by date or amount (ascending/descending)
- Refund status displayed inline per payment
