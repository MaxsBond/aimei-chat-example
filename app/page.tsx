import Image from "next/image";
import styles from "./page.module.css";
import Chat from "./chat";

export default function Home() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh'
    }}>
        <Chat />
    </div>
  );
}
