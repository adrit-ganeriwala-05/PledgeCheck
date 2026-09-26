// Generated from the local database, then formatted:
//   npx supabase@2.118.0 gen types typescript --local --schema public > apps/web/lib/supabase/types.ts
//   npx prettier@3.6.2 --write apps/web/lib/supabase/types.ts
// Do not edit by hand; regenerate after changing db/*.sql.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      anchors: {
        Row: {
          cluster: string;
          created_at: string;
          head_hash: string;
          head_seq: number;
          id: string;
          solana_signature: string | null;
        };
        Insert: {
          cluster?: string;
          created_at?: string;
          head_hash: string;
          head_seq: number;
          id?: string;
          solana_signature?: string | null;
        };
        Update: {
          cluster?: string;
          created_at?: string;
          head_hash?: string;
          head_seq?: number;
          id?: string;
          solana_signature?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "anchors_head_seq_fkey";
            columns: ["head_seq"];
            isOneToOne: false;
            referencedRelation: "audit_events";
            referencedColumns: ["seq"];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor: string;
          created_at: string;
          hash: string;
          payload: NonNullable<Json>;
          prev_hash: string | null;
          ref_id: string | null;
          seq: number;
        };
        Insert: {
          action: string;
          actor: string;
          created_at?: string;
          hash: string;
          payload?: NonNullable<Json>;
          prev_hash?: string | null;
          ref_id?: string | null;
          seq?: number;
        };
        Update: {
          action?: string;
          actor?: string;
          created_at?: string;
          hash?: string;
          payload?: NonNullable<Json>;
          prev_hash?: string | null;
          ref_id?: string | null;
          seq?: number;
        };
        Relationships: [];
      };
      clinicians: {
        Row: {
          display_name: string;
          id: string;
          practice_id: string;
          role: string;
        };
        Insert: {
          display_name: string;
          id: string;
          practice_id: string;
          role: string;
        };
        Update: {
          display_name?: string;
          id?: string;
          practice_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clinicians_practice_id_fkey";
            columns: ["practice_id"];
            isOneToOne: false;
            referencedRelation: "practices";
            referencedColumns: ["id"];
          },
        ];
      };
      patients: {
        Row: {
          can_get_pregnant: boolean;
          home_testing_allowed: boolean;
          id: string;
          language: string;
          phase: string;
          practice_id: string;
          pseudonym: string;
          treatment_start: string | null;
        };
        Insert: {
          can_get_pregnant: boolean;
          home_testing_allowed?: boolean;
          id?: string;
          language?: string;
          phase: string;
          practice_id: string;
          pseudonym: string;
          treatment_start?: string | null;
        };
        Update: {
          can_get_pregnant?: boolean;
          home_testing_allowed?: boolean;
          id?: string;
          language?: string;
          phase?: string;
          practice_id?: string;
          pseudonym?: string;
          treatment_start?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "patients_practice_id_fkey";
            columns: ["practice_id"];
            isOneToOne: false;
            referencedRelation: "practices";
            referencedColumns: ["id"];
          },
        ];
      };
      practices: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          clinician_id: string;
          decided_at: string;
          decision: string;
          id: string;
          reason: string | null;
          submission_id: string;
        };
        Insert: {
          clinician_id: string;
          decided_at?: string;
          decision: string;
          id?: string;
          reason?: string | null;
          submission_id: string;
        };
        Update: {
          clinician_id?: string;
          decided_at?: string;
          decision?: string;
          id?: string;
          reason?: string | null;
          submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_clinician_id_fkey";
            columns: ["clinician_id"];
            isOneToOne: false;
            referencedRelation: "clinicians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: true;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      submissions: {
        Row: {
          captured_at: string | null;
          cv_confidence: number | null;
          cv_result: string | null;
          flags: string[];
          grok_code: string | null;
          grok_confidence: number | null;
          grok_result: string | null;
          id: string;
          phash: string | null;
          photo_path: string | null;
          request_id: string;
          status: string;
        };
        Insert: {
          captured_at?: string | null;
          cv_confidence?: number | null;
          cv_result?: string | null;
          flags?: string[];
          grok_code?: string | null;
          grok_confidence?: number | null;
          grok_result?: string | null;
          id?: string;
          phash?: string | null;
          photo_path?: string | null;
          request_id: string;
          status: string;
        };
        Update: {
          captured_at?: string | null;
          cv_confidence?: number | null;
          cv_result?: string | null;
          flags?: string[];
          grok_code?: string | null;
          grok_confidence?: number | null;
          grok_result?: string | null;
          id?: string;
          phash?: string | null;
          photo_path?: string | null;
          request_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submissions_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: true;
            referencedRelation: "test_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      test_requests: {
        Row: {
          challenge_code: string;
          created_by: string;
          expires_at: string;
          id: string;
          patient_id: string;
          setting: string;
          token_hash: string;
          used_at: string | null;
        };
        Insert: {
          challenge_code: string;
          created_by: string;
          expires_at: string;
          id?: string;
          patient_id: string;
          setting: string;
          token_hash: string;
          used_at?: string | null;
        };
        Update: {
          challenge_code?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          patient_id?: string;
          setting?: string;
          token_hash?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "test_requests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "clinicians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "test_requests_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      windows: {
        Row: {
          closes_at: string;
          filled_at: string | null;
          id: string;
          is_first_rx: boolean;
          opens_at: string;
          patient_id: string;
          status: string;
          submission_id: string | null;
        };
        Insert: {
          closes_at: string;
          filled_at?: string | null;
          id?: string;
          is_first_rx?: boolean;
          opens_at: string;
          patient_id: string;
          status?: string;
          submission_id?: string | null;
        };
        Update: {
          closes_at?: string;
          filled_at?: string | null;
          id?: string;
          is_first_rx?: boolean;
          opens_at?: string;
          patient_id?: string;
          status?: string;
          submission_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "windows_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "windows_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      submit_review: {
        Args: {
          p_decision: string;
          p_reason: string;
          p_submission_id: string;
          p_window: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
