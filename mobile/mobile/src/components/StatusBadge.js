import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { STATUS_COLORS } from '../theme'

const LABELS = {
  Posted: 'Posted',
  Accepted: 'Accepted',
  InProgress: 'In Progress',
  Completed: 'Completed',
  PendingPayment: 'Pending Payment',
  Paid: 'Paid',
  Disputed: 'Disputed',
  Cancelled: 'Cancelled',
  Draft: 'Draft',
}

export default function StatusBadge({ status, small }) {
  const colors = STATUS_COLORS[status] || { bg: '#F3F4F6', text: '#6B7280' }
  const label = LABELS[status] || status

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }, small && styles.small]}>
      <Text style={[styles.text, { color: colors.text }, small && styles.smallText]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  small: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  smallText: {
    fontSize: 11,
  },
})
