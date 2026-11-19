![CI Status](https://github.com/theshashanknanda/voltix-ai/actions/workflows/ci.yml/badge.svg)

# ⚡ Voltix AI

Voltix AI is an intelligent web-based assistant designed to help developers understand, maintain, and improve existing codebases. Instead of focusing on generating new code, Voltix AI emphasizes **code comprehension, onboarding support, maintainability insights, and documentation quality**.

Modern software projects often suffer from poor documentation, inconsistent coding standards, and high onboarding costs for new developers. Voltix AI addresses these challenges by analyzing a project’s codebase and providing **context-aware explanations, quality recommendations, and AI-generated documentation** through a developer-friendly web interface.

---

## 🚀 Motivation

Developers frequently spend significant time understanding unfamiliar codebases, especially in large or legacy systems. Documentation is often outdated, and critical knowledge is spread across senior team members.

Existing tools such as linters, documentation generators, and AI coding assistants provide partial solutions, but they typically lack:
- Context-aware explanations tailored to a specific codebase
- Onboarding-focused guidance for new developers
- Ongoing maintainability and quality insights

Voltix AI is designed to bridge this gap by acting as an intelligent guide for both individuals and development teams.

---

## 🎯 Objectives

Voltix AI aims to:

- Reduce onboarding time for developers working on existing codebases
- Provide clear, AI-generated explanations of code structure and logic
- Identify maintainability issues and code quality concerns
- Generate and maintain up-to-date documentation from source code
- Offer a scalable and developer-friendly web platform

---

## 🧠 Planned Features

### Codebase Ingestion
- Upload codebases using ZIP files or Git repository URLs
- Parse project structure and detect application entry points

### AI-Powered Code Understanding
- File-level and function-level explanations
- Context-aware insights with dependency references
- Clear descriptions of data flow and logic

### Code Quality & Maintainability Analysis
- Detection of common code smells
- Actionable refactoring suggestions
- Maintainability scoring and explanations

### AI-Generated Documentation
- Automatic documentation for modules, functions, and classes
- Documentation updates when code changes
- Usage examples to improve clarity

### Web Dashboard & User Experience
- Centralized dashboard for all insights
- File navigation and search functionality
- Side-by-side view of source code and explanations

### Security & Performance
- Secure code uploads and data handling
- Automatic cleanup after analysis
- Efficient processing of large codebases

---

## 🏗️ Repository Structure

The app now includes a React/Vite frontend and an Express/Prisma/PostgreSQL backend.
Implemented features include GitHub/ZIP imports, code browsing, AI explanations,
documentation generation, maintainability reviews, and saved analyses. Auth0
sign-in and Stripe billing setup are documented in
[Authentication and billing](documentation/auth0-billing.md), including the
integration contracts for the open saved-project, chat, and edit issues.

- All system functionality is captured as **user stories** in GitHub Issues
- User stories are grouped under **epics**
- A single milestone, **Product Backlog**, represents the full scope of the system
- Each user story includes:
  - Description
  - Acceptance Criteria
  - Testing Scenarios

Run `npm ci` and `npm run dev` separately in `backend` and `frontend` after
configuring their environment files and applying the database migrations.

---

## 📄 License

This project is developed for academic purposes.
