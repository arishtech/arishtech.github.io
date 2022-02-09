<?php
// Create typography section
CSF::createSection( $restlyThemeOption, array(
    'title'  => esc_html__( 'Typography', 'restly' ),
    'id'     => 'restly_typography_options',
    'icon'   => 'fa fa-text-width',
    'fields' => array(

        array(
            'id'           => 'restly_body_typo',
            'type'         => 'typography',
            'title'        => esc_html__( 'Body', 'restly' ),
            'output'       => 'body',
            'default'      => array(
                'font-family'  => 'Rubik',
                'font-size'    => '16',
                'unit'         => 'px',
                'color'        => '#454545',
                'font-weight'  => '400',
                'extra-styles' => array( '300', '400', '500', '600', '700', '800', '900', '300i', '400i', '500i', '600i', '700i', '800i', '900i' ),
            ),
            'extra_styles' => true,
            'subtitle'     => esc_html__( 'Set body typography.', 'restly' ),
        ),

        array(
            'id'           => 'restly_h1_typo',
            'type'         => 'typography',
            'title'        => esc_html__( 'Heading One', 'restly' ),
            'output'       => 'h1',
            'extra_styles' => true,
            'default'      => array(
                'font-family' => 'Nunito',
                'unit'        => 'px',
                'font-weight' => '700',
                'color'       => '#1d2c38',
            ),
            'subtitle'     => esc_html__( 'Set heading one typography.', 'restly' ),
        ),

        array(
            'id'           => 'restly_h2_typo',
            'type'         => 'typography',
            'title'        => esc_html__( 'Heading Two', 'restly' ),
            'output'       => 'h2',
            'extra_styles' => true,
            'default'      => array(
                'font-family' => 'Nunito',
                'unit'        => 'px',
                'font-weight' => '700',
                'color'       => '#1d2c38',
            ),
            'subtitle'     => esc_html__( 'Set heading two typography.', 'restly' ),
        ),

        array(
            'id'           => 'restly_h3_typo',
            'type'         => 'typography',
            'title'        => esc_html__( 'Heading Three', 'restly' ),
            'output'       => 'h3',
            'default'      => array(
                'font-family' => 'Nunito',
                'unit'        => 'px',
                'font-weight' => '700',
                'color'       => '#1d2c38',
            ),
            'extra_styles' => true,
            'subtitle'     => esc_html__( 'Set heading three typography.', 'restly' ),
        ),

        array(
            'id'           => 'restly_h4_typo',
            'type'         => 'typography',
            'title'        => esc_html__( 'Heading Four', 'restly' ),
            'output'       => 'h4',
            'default'      => array(
                'font-family' => 'Nunito',
                'unit'        => 'px',
                'font-weight' => '700',
                'color'       => '#1d2c38',
            ),
            'extra_styles' => true,
            'subtitle'     => esc_html__( 'Set heading four typography.', 'restly' ),
        ),

        array(
            'id'           => 'restly_h5_typo',
            'type'         => 'typography',
            'title'        => esc_html__( 'Heading Five', 'restly' ),
            'output'       => 'h5',
            'default'      => array(
                'font-family' => 'Nunito',
                'unit'        => 'px',
                'font-weight' => '700',
                'color'       => '#1d2c38',
            ),
            'extra_styles' => true,
            'subtitle'     => esc_html__( 'Set heading five typography.', 'restly' ),
        ),

        array(
            'id'           => 'restly_h6_typo',
            'type'         => 'typography',
            'title'        => esc_html__( 'Heading Six', 'restly' ),
            'output'       => 'h6',
            'default'      => array(
                'font-family' => 'Nunito',
                'unit'        => 'px',
                'font-weight' => '700',
                'color'       => '#1d2c38',
            ),
            'extra_styles' => true,
            'subtitle'     => esc_html__( 'Set heading six typography.', 'restly' ),
        ),
    ),
) );
// End typography section