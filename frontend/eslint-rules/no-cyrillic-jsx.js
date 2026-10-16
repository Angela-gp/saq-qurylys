const cyrillic = /[\u0400-\u052f]/

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require localized dictionaries for Cyrillic JSX copy' },
    schema: [],
    messages: { hardcoded: 'Move user-facing Cyrillic text to the locale dictionaries.' },
  },
  create(context) {
    return {
      JSXText(node) {
        if (cyrillic.test(node.value.trim())) context.report({ node, messageId: 'hardcoded' })
      },
      JSXAttribute(node) {
        if (node.value?.type === 'Literal' && typeof node.value.value === 'string' && cyrillic.test(node.value.value)) {
          context.report({ node, messageId: 'hardcoded' })
        }
        const expression = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : null
        if ((expression?.type === 'Literal' && typeof expression.value === 'string') || expression?.type === 'TemplateLiteral') {
          const text = expression.type === 'Literal' ? expression.value : expression.expressions.length === 0 ? expression.quasis[0].value.cooked : ''
          if (typeof text === 'string' && cyrillic.test(text)) context.report({ node, messageId: 'hardcoded' })
        }
      },
      JSXExpressionContainer(node) {
        const expression = node.expression
        if (expression.type === 'Literal' && typeof expression.value === 'string' && cyrillic.test(expression.value)) {
          context.report({ node, messageId: 'hardcoded' })
        }
        if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0 && cyrillic.test(expression.quasis[0].value.cooked ?? '')) {
          context.report({ node, messageId: 'hardcoded' })
        }
      },
    }
  },
}
