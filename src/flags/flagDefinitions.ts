import { defineFlag } from './flagSystem'

export const FLAGS = {
  MODERN_DESIGN: defineFlag('modern-design', {
    type: 'boolean',
    default: false,
    description: 'Enables the modernized CSS design system',
    temporary: true,
  }),
  MONTHLY_CHECK_IN: defineFlag('monthly-check-in', {
    type: 'boolean',
    default: false,
    description: 'Home check-in strip, partial-month indicators, and Details check-in mode',
    temporary: true,
  }),
} as const
