import React from 'react'
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native'
import { COLORS } from '../theme'

export default function LoadingView({ message }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.purple} />
      {message ? <Text style={styles.text}>{message}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    gap: 12,
  },
  text: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontFamily: 'Inter_400Regular',
  },
})
