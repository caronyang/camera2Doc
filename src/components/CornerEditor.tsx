// 四角可拖曳編輯器：疊在圖片上，座標以 0..1 歸一化
// 使用 View 內建 responder props（事件期 setState），不依賴 PanResponder/ref
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Circle, Polygon, Svg } from 'react-native-svg';

import { clamp01 } from '@/lib/model';
import { colors } from './ui';

interface Props {
  /** 圖片實際顯示寬度（px） */
  displayW: number;
  /** 圖片實際顯示高度（px） */
  displayH: number;
  /** 8 個數值：tl,tr,br,bl 的歸一化座標 */
  corners: number[];
  onChange: (corners: number[]) => void;
}

const HANDLE = 26;

interface DragState {
  index: number;
  /** 按下時該角歸一化位置 */
  bx: number;
  by: number;
  /** 按下時螢幕座標 */
  ox: number;
  oy: number;
}

export default function CornerEditor({ displayW, displayH, corners, onChange }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);

  const points = [0, 1, 2, 3]
    .map((i) => `${corners[i * 2] * displayW},${corners[i * 2 + 1] * displayH}`)
    .join(' ');

  const onGrant = (index: number, pageX: number, pageY: number) => {
    setDrag({ index, bx: corners[index * 2], by: corners[index * 2 + 1], ox: pageX, oy: pageY });
  };

  const onMove = (pageX: number, pageY: number) => {
    if (!drag || drag.index == null) return;
    const next = [...corners];
    next[drag.index * 2] = clamp01(drag.bx + (pageX - drag.ox) / displayW);
    next[drag.index * 2 + 1] = clamp01(drag.by + (pageY - drag.oy) / displayH);
    onChange(next);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Svg width={displayW} height={displayH} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Polygon points={points} fill="rgba(43,140,255,0.12)" stroke={colors.primary} strokeWidth={2} />
      </Svg>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          hitSlop={10}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => onGrant(i, e.nativeEvent.pageX, e.nativeEvent.pageY)}
          onResponderMove={(e) => onMove(e.nativeEvent.pageX, e.nativeEvent.pageY)}
          onResponderRelease={() => setDrag(null)}
          onResponderTerminate={() => setDrag(null)}
          style={[
            styles.handleWrap,
            {
              left: corners[i * 2] * displayW - HANDLE / 2,
              top: corners[i * 2 + 1] * displayH - HANDLE / 2,
            },
          ]}
        >
          <Svg width={HANDLE} height={HANDLE}>
            <Circle
              cx={HANDLE / 2}
              cy={HANDLE / 2}
              r={HANDLE / 2 - 3}
              fill={drag?.index === i ? colors.primary : '#ffffff'}
              stroke={colors.primary}
              strokeWidth={3}
            />
          </Svg>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  handleWrap: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
