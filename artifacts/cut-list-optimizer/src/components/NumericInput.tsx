import { useRef, type InputHTMLAttributes } from 'react';

// Replace a default zero on first focus without changing the value just by
// visiting the field. Later clicks still allow normal cursor placement.
export function NumericInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const selectedZero = useRef(false);
  return (
    <input
      {...props}
      onFocus={event => {
        const input = event.currentTarget;
        selectedZero.current = input.value.trim() !== '' && Number(input.value) === 0;
        if (selectedZero.current) input.select();
        props.onFocus?.(event);
      }}
      onMouseUp={event => {
        if (selectedZero.current) {
          event.preventDefault();
          selectedZero.current = false;
        }
        props.onMouseUp?.(event);
      }}
      onBlur={event => {
        selectedZero.current = false;
        props.onBlur?.(event);
      }}
    />
  );
}