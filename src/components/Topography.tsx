export default function Topography() {
  return (
    <div className="topography" aria-hidden="true">
      <svg viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice">
        <g fill="none" stroke="currentColor" strokeWidth="1.2">
          {Array.from({ length: 14 }, (_, i) => (
            <path
              key={i}
              d={`M ${-240 + i * 32} -100 C ${720 + i * 18} ${70 + i * 28}, ${-260 + i * 42} ${560 - i * 9}, ${360 + i * 30} ${670 + i * 17} S ${1650 - i * 10} ${260 + i * 35}, 1700 ${940 + i * 25}`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
